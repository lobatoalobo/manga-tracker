/**
 * Normaliza los géneros existentes a la taxonomía canónica (lib/genres.ts):
 * guarda los crudos en `rawGenres` (backup), pone los canónicos en `genres` y
 * extrae la demografía a `demographic`. Idempotente: si ya hay `rawGenres`,
 * re-mapea desde ahí (no pierde el crudo).
 *
 *   node scripts/with-staging.mjs npx tsx scripts/normalize-genres.ts [--apply]
 *   npx tsx scripts/normalize-genres.ts --apply           # contra prod (.env)
 * Sin --apply: dry-run (reporta, no escribe).
 */
import { prisma } from "../lib/prisma";
import { normalizeGenres } from "../lib/genres";

async function main() {
  const apply = process.argv.includes("--apply");
  const works = await prisma.work.findMany({
    select: { id: true, title: true, genres: true, rawGenres: true, demographic: true },
  });

  let changed = 0;
  let demoSet = 0;
  const samples: string[] = [];

  for (const w of works) {
    // Fuente = el crudo si ya lo respaldamos; si no, los géneros actuales (crudos).
    const source = w.rawGenres.length ? w.rawGenres : w.genres;
    if (source.length === 0) continue;
    const { genres, demographic } = normalizeGenres(source);

    const sameGenres =
      genres.length === w.genres.length &&
      genres.every((g) => w.genres.includes(g));
    const sameRaw = w.rawGenres.length > 0;
    const sameDemo = (w.demographic ?? null) === (demographic ?? null);
    if (sameGenres && sameRaw && sameDemo) continue;

    changed++;
    if (demographic && !sameDemo) demoSet++;
    if (samples.length < 20)
      samples.push(
        `${w.title}: [${source.slice(0, 4).join(", ")}] → [${genres.join(", ")}]${demographic ? ` · ${demographic}` : ""}`,
      );

    if (apply)
      await prisma.work.update({
        where: { id: w.id },
        data: {
          rawGenres: w.rawGenres.length ? w.rawGenres : w.genres,
          genres,
          demographic,
        },
      });
  }

  console.log(samples.join("\n"));
  console.log(
    `\n${apply ? "APLICADO" : "[DRY]"} · obras ${works.length} · a cambiar ${changed} · con demografía ${demoSet}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
