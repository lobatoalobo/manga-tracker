/**
 * Depuración: 1 edición regular por (obra, editorial) — la más completa. Borra
 * specials/duplicados seguros + works huérfanos; marca homónimos ambiguos. Usa
 * la misma lógica que la tarea admin (lib/curation).
 *
 *   npx tsx scripts/depurate-catalog.ts            # dry-run
 *   npx tsx scripts/depurate-catalog.ts --apply
 */
import { prisma } from "../lib/prisma";
import { depurateCatalog } from "../lib/curation";

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");
  const r = await depurateCatalog(!apply);
  for (const s of r.samples) console.log("· " + s);
  console.log(
    `\n${r.changed} ediciones ${apply ? "borradas" : "a borrar"}${r.note ? ` · ${r.note}` : ""}`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
