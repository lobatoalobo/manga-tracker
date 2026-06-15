/**
 * Separa homónimos que quedaron fusionados en un mismo Work por el agrupado viejo
 * (normTitle borra el "+", así Citrus+ cayó en el Work de Citrus). Mueve cada
 * edición SIN mapear cuyo título estricto difiere del del Work a su propio Work.
 *
 *   npx tsx scripts/split-homonyms.ts            # dry-run
 *   npx tsx scripts/split-homonyms.ts --apply
 *
 * Solo toca ediciones sin anilistId (las mapeadas están ancladas por su id).
 */
import { prisma } from "../lib/prisma";
import { tightTitleKey, findOrCreateWork } from "../lib/catalog";

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");

  const works = await prisma.work.findMany({
    select: {
      id: true,
      title: true,
      editions: { select: { id: true, title: true, anilistId: true } },
    },
  });

  let moved = 0;
  for (const w of works) {
    if (w.editions.length < 2) continue;
    const anchor = tightTitleKey(w.title);
    for (const e of w.editions) {
      if (e.anilistId != null) continue; // anclada por anilistId
      if (tightTitleKey(e.title) === anchor) continue; // mismo título: ok
      console.log(`· #${e.id} "${e.title}" sale del work ${w.id} "${w.title}"`);
      if (apply) {
        const newId = await findOrCreateWork({ title: e.title, anilistId: null });
        if (newId !== w.id) {
          await prisma.publisherEdition.update({
            where: { id: e.id },
            data: { workId: newId },
          });
          moved++;
        }
      } else {
        moved++;
      }
    }
  }

  console.log(`\n${moved} ediciones a separar en works propios.`);
  if (apply) {
    const orphans = await prisma.work.deleteMany({ where: { editions: { none: {} } } });
    console.log(`Movidas ${moved}; ${orphans.count} works huérfanos borrados.`);
  } else {
    console.log("DRY-RUN: nada cambiado. Corré con --apply.");
  }

  await prisma.$disconnect();
}

main();
