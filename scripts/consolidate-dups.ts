/**
 * Consolida duplicados de misma editorial + título + tomos (crawl + Whakoom de
 * la misma serie) en UNA edición: anilistId + link real de la editorial. Usa la
 * misma lógica que la tarea admin (lib/curation).
 *
 *   npx tsx scripts/consolidate-dups.ts            # dry-run
 *   npx tsx scripts/consolidate-dups.ts --apply
 */
import { prisma } from "../lib/prisma";
import { consolidateDups } from "../lib/curation";

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");
  const r = await consolidateDups(!apply);
  for (const s of r.samples) console.log("· " + s);
  console.log(
    `\n${r.changed} ediciones ${apply ? "borradas (consolidadas)" : "a consolidar"}${r.note ? ` · ${r.note}` : ""}`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
