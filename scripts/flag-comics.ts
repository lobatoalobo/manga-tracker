/**
 * Marca/borra ediciones que parecen cómic occidental (Marvel/DC). Usa la misma
 * lógica que la tarea admin (lib/curation).
 *
 *   npx tsx scripts/flag-comics.ts            # dry-run
 *   npx tsx scripts/flag-comics.ts --apply
 */
import { prisma } from "../lib/prisma";
import { flagComics } from "../lib/curation";

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");
  const r = await flagComics(!apply);
  for (const s of r.samples) console.log("· " + s);
  console.log(
    `\n${r.changed} parecen cómic (de ${r.scanned} sin mapear)${apply ? " — borradas" : ""}${r.note ? ` · ${r.note}` : ""}`,
  );
  if (!apply) console.log("DRY-RUN: revisá y corré con --apply.");
  await prisma.$disconnect();
}

main();
