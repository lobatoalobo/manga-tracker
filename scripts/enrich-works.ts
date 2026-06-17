/**
 * Enriquece Works desde MangaUpdates + MangaDex (géneros + respaldo de portada/
 * sinopsis), matcheando por el título original (romaji) de Ivrea. Batch
 * resumable: corré varias veces (procesa los `enrichedAt = null`).
 *
 *   node scripts/with-staging.mjs npx tsx scripts/enrich-works.ts [--limit N] [--dry] [--force]
 */
import { enrichWorks } from "../lib/enrichWorks";
import { prisma } from "../lib/prisma";

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const limit = Number(arg("--limit")) || 50;
  const dryRun = process.argv.includes("--dry");
  const force = process.argv.includes("--force");

  const pending = await prisma.work.count({ where: { enrichedAt: null } });
  console.log(`Works sin enriquecer: ${pending}. Procesando hasta ${limit}…\n`);

  const r = await enrichWorks({ limit, dryRun, force });
  console.log(r.samples.join("\n"));
  console.log(
    `\n${dryRun ? "[DRY] " : ""}scanned ${r.scanned} · con datos ${r.enriched} · match MU ${r.matchedMU} · match MD ${r.matchedMD}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
