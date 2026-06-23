/**
 * Enriquece Works desde MangaUpdates + MangaDex (géneros + respaldo de portada/
 * sinopsis), matcheando por el título original (romaji) de Ivrea. Batch
 * resumable: corré varias veces (procesa los `enrichedAt = null`).
 *
 *   node scripts/with-staging.mjs npx tsx scripts/enrich-works.ts [--limit N] [--dry] [--force]
 *
 * Recovery de portadas (solo Works sin portada, re-busca en MU/MD vía proxy):
 *   node scripts/with-prod.mjs npx tsx scripts/enrich-works.ts --missing-cover --limit 200
 */
import { enrichWorks } from "../lib/enrichWorks";
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const limit = Number(arg("--limit")) || 50;
  const dryRun = process.argv.includes("--dry");
  const force = process.argv.includes("--force");
  const onlyMissingCover = process.argv.includes("--missing-cover");
  const onlyMissingGenres = process.argv.includes("--missing-genres");
  const onlyMissingIdentity = process.argv.includes("--missing-identity");

  // dbRetry: el endpoint directo de Neon tira P1001 en cold-start (este count es
  // lo primero que toca la base). Ver memoria maintenance-tooling-robust.
  const pending = await dbRetry(() =>
    onlyMissingCover
      ? prisma.work.count({ where: { coverImage: null } })
      : onlyMissingGenres
        ? prisma.work.count({ where: { editions: { some: {} }, genres: { isEmpty: true } } })
        : onlyMissingIdentity
          ? prisma.work.count({
              where: { editions: { some: {} }, OR: [{ mdId: null }, { muId: null }] },
            })
          : prisma.work.count({ where: { enrichedAt: null } }),
  );
  const label = onlyMissingCover
    ? "Works sin portada"
    : onlyMissingGenres
      ? "Works sin géneros"
      : onlyMissingIdentity
        ? "Works sin identidad (mdId)"
        : "Works sin enriquecer";
  console.log(`${label}: ${pending}. Procesando hasta ${limit}…\n`);

  const r = await enrichWorks({
    limit,
    dryRun,
    force,
    onlyMissingCover,
    onlyMissingGenres,
    onlyMissingIdentity,
  });
  console.log(r.samples.join("\n"));
  console.log(
    `\n${dryRun ? "[DRY] " : ""}scanned ${r.scanned} · con datos ${r.enriched} · match MU ${r.matchedMU} · match MD ${r.matchedMD}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
