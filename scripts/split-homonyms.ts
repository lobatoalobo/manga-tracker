/**
 * Separa homónimos fusionados en works distintos (Citrus vs Citrus+). Usa la
 * misma lógica que la tarea admin (lib/curation).
 *
 *   npx tsx scripts/split-homonyms.ts            # dry-run
 *   npx tsx scripts/split-homonyms.ts --apply
 */
import { prisma } from "../lib/prisma";
import { splitHomonyms } from "../lib/curation";

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");
  const r = await splitHomonyms(!apply);
  for (const s of r.samples) console.log("· " + s);
  console.log(
    `\n${r.changed} ediciones ${apply ? "separadas" : "a separar"}${r.note ? ` · ${r.note}` : ""}`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
