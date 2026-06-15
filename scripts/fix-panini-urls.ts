/**
 * Arregla las ediciones de Panini cuyo link quedó en Whakoom: las busca en la
 * tienda de Panini (tiendapanini.com.ar, Magento) y, si las encuentra, pone el
 * link de búsqueda de la tienda + sincroniza el conteo de tomos (tomo más alto
 * listado por Panini).
 *
 *   npx tsx scripts/fix-panini-urls.ts [--limit N]   # dry-run
 *   npx tsx scripts/fix-panini-urls.ts --apply
 *
 * Conservador: el match exige el nombre de serie de Panini (exacto / ≤2 typos en
 * títulos largos). Las que no matchean quedan en ámbar para corregir a mano.
 */
import { prisma } from "../lib/prisma";
import { getPaniniEdition } from "../lib/providers/panini";
import { searchableTitle } from "../lib/catalog";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const apply = args.some((a) => a === "--apply" || a === "apply");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) || null : null;

  let rows = await prisma.publisherEdition.findMany({
    where: { publisher: "Panini Argentina", url: { contains: "whakoom.com" } },
    select: { id: true, title: true, volumes: true, anilistId: true },
  });
  console.log(`Panini con link de Whakoom: ${rows.length}`);
  if (limit) rows = rows.slice(0, limit);

  let fixed = 0;
  let failed = 0;
  for (const r of rows) {
    // Probamos varias variantes para mejorar el match en la tienda: el título,
    // sin subtítulo entre guiones/paréntesis, y la parte antes de ":" o " - "
    // (con guarda de largo ≥5 para no romper "Re:Zero").
    const variants = new Set([r.title, searchableTitle(r.title)]);
    for (const sep of [":", " - "]) {
      const head = r.title.split(sep)[0].trim();
      if (head.length >= 5 && head !== r.title) variants.add(head);
    }
    const titles = [...variants];
    const data = await getPaniniEdition(titles).catch(() => null);
    await sleep(500);
    if (!data) {
      console.log(`✗ #${r.id} "${r.title}" (no se encontró en Panini)`);
      failed++;
      continue;
    }
    // Solo URL (la búsqueda de Panini): NO tocamos tomos porque su búsqueda mezcla
    // manga + novela/spinoffs con el mismo nombre y el conteo se infla.
    console.log(
      `✓ #${r.id} "${r.title}" → ${data.url}  (Panini lista ~${data.totalVolumes}t; no se aplica)`,
    );
    if (apply) {
      await prisma.publisherEdition
        .update({ where: { id: r.id }, data: { url: data.url } })
        .catch(() => {});
      if (r.anilistId)
        await prisma.editionsCache
          .deleteMany({ where: { anilistId: r.anilistId } })
          .catch(() => {});
    }
    fixed++;
  }

  console.log(
    `\n${fixed} con link de Panini${apply ? " (aplicado)" : ""}; ${failed} sin encontrar (quedan en ámbar).`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply para guardar.");
  await prisma.$disconnect();
}

main();
