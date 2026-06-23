/**
 * Reorganiza las sinopsis existentes a synopsisEs/synopsisEn (sin traducir).
 * Detecta el idioma del texto (marcadores ES vs EN); si no se puede, usa como
 * pista si la obra tiene edición ES. También toma la sinopsis EN guardada en la
 * edición VIZ. Idempotente, dbRetry. Sin red.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/backfill-synopsis-lang.ts [--dry]
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";

/** Adivina el idioma de una sinopsis por marcadores. null = no seguro. */
function guessLang(text: string): "es" | "en" | null {
  const t = ` ${text.toLowerCase()} `;
  if (/[ñ¿¡]|[áéíóú]/.test(text)) return "es";
  const es = (t.match(/ (el|la|los|las|que|de|en|una|un|por|con|su|del|para|como) /g) || []).length;
  const en = (t.match(/ (the|and|of|to|in|a|is|his|her|with|that|for|as) /g) || []).length;
  if (es > en && es >= 2) return "es";
  if (en > es && en >= 2) return "en";
  return null;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { OR: [{ synopsis: { not: null } }, { editions: { some: { synopsis: { not: null } } } }] },
      select: {
        id: true,
        synopsis: true,
        synopsisEs: true,
        synopsisEn: true,
        editions: { select: { language: true, synopsis: true } },
      },
    }),
  );

  let es = 0;
  let en = 0;
  for (const w of works) {
    const data: { synopsisEs?: string; synopsisEn?: string } = {};
    // 1) Work.synopsis → al idioma que detectemos (pista: ¿tiene edición ES?).
    if (w.synopsis && !w.synopsisEs && !w.synopsisEn) {
      const hasEs = w.editions.some((e) => e.language === "es");
      const lang = guessLang(w.synopsis) ?? (hasEs ? "es" : "en");
      if (lang === "es") data.synopsisEs = w.synopsis;
      else data.synopsisEn = w.synopsis;
    }
    // 2) Sinopsis EN guardada en la edición VIZ → synopsisEn si falta.
    const vizSyn = w.editions.find((e) => e.language === "en" && e.synopsis)?.synopsis;
    if (vizSyn && !w.synopsisEn && !data.synopsisEn) data.synopsisEn = vizSyn;

    if (!Object.keys(data).length) continue;
    if (data.synopsisEs) es++;
    if (data.synopsisEn) en++;
    if (!dry)
      await dbRetry(() => prisma.work.update({ where: { id: w.id }, data })).catch(() => {});
  }

  console.log(`${dry ? "[DRY] " : ""}synopsisEs +${es} · synopsisEn +${en} (de ${works.length} obras con sinopsis)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
