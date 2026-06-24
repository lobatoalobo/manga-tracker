/**
 * Completa la versión de sinopsis que falta traduciendo la que tenemos (la nativa
 * de la fuente manda; la traducida se marca `...Auto`). Solo obras que tienen UNA
 * de las dos. Idempotente, dbRetry, throttle. Requiere DEEPL_API_KEY o
 * ANTHROPIC_API_KEY (sin eso, no hace nada). Ver docs/analisis-sistema-datos.md.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/translate-synopses.ts [--limit N] [--dry]
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { translateSynopsis, translatorConfigured } from "../lib/translate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!translatorConfigured()) {
    console.error("✗ Falta DEEPL_API_KEY o ANTHROPIC_API_KEY. Nada que hacer.");
    process.exit(1);
  }
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const limit = Number(arg("--limit")) || 2000;
  const dry = process.argv.includes("--dry");

  // Obras con UNA sola versión (la otra se puede traducir).
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: {
        editions: { some: {} },
        OR: [
          { synopsisEs: { not: null }, synopsisEn: null },
          { synopsisEs: null, synopsisEn: { not: null } },
        ],
      },
      select: { id: true, title: true, synopsisEs: true, synopsisEn: true },
      take: limit,
    }),
  );
  console.log(`${works.length} obras con una sola versión a completar…\n`);

  let ok = 0;
  let fail = 0;
  for (const w of works) {
    const from = w.synopsisEs ? "es" : "en";
    const to = from === "es" ? "en" : "es";
    const out = await translateSynopsis(from === "es" ? w.synopsisEs : w.synopsisEn, from, to);
    if (!out) {
      fail++;
      if (fail <= 10) console.log(`  ✗ ${w.title} (${from}→${to})`);
      await sleep(500);
      continue;
    }
    if (!dry)
      await dbRetry(() =>
        prisma.work.update({
          where: { id: w.id },
          data:
            to === "es"
              ? { synopsisEs: out, synopsisEsAuto: true }
              : { synopsisEn: out, synopsisEnAuto: true },
        }),
      ).catch(() => {});
    ok++;
    if (ok <= 15) console.log(`  ✓ ${w.title} (${from}→${to})`);
    await sleep(500);
  }

  console.log(`\n${dry ? "[DRY] " : ""}traducidas ${ok} · fallaron ${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
