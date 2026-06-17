/**
 * Enriquece el Work de una edición con datos de Whakoom (autor/sinopsis/portada),
 * rellenando SOLO lo que falte (no pisa lo ya cargado).
 *
 * Whakoom (Cloudflare) bloquea las IPs de datacenter, así que el botón admin en
 * Vercel no puede leer la página. Este script corre LOCAL (IP no bloqueada),
 * igual que los crawls de Whakoom, y escribe en la misma DB que usa la app.
 *
 *   npx tsx scripts/enrich-whakoom.ts <editionId> <whakoomUrl> [--force]
 *
 * <editionId>  = el id de /nacional/<id> (o cualquier publisherEdition.id)
 * --force      = pisa autor/sinopsis/portada aunque ya tengan valor
 */
import { prisma } from "../lib/prisma";
import { getWhakoomEdition } from "../lib/providers/whakoom";
import { findOrCreateWork } from "../lib/catalog";

async function main() {
  const [idArg, url] = process.argv.slice(2);
  const force = process.argv.includes("--force");
  const editionId = Number(idArg);
  if (!editionId || !url || !/whakoom\.com\/ediciones\//i.test(url)) {
    console.error(
      "Uso: npx tsx scripts/enrich-whakoom.ts <editionId> <whakoomUrl> [--force]",
    );
    process.exit(1);
  }

  const row = await prisma.publisherEdition.findUnique({
    where: { id: editionId },
    include: { work: true },
  });
  if (!row) {
    console.error(`No existe la edición ${editionId}.`);
    process.exit(1);
  }

  const ed = await getWhakoomEdition(url);
  if (!ed) {
    console.error("No se pudo leer esa página de Whakoom (¿IP bloqueada?).");
    process.exit(1);
  }
  console.log(`Whakoom → ${ed.title} · ${ed.author ?? "—"} · ${ed.publisher}`);

  // Asegurar Work linkeado.
  let workId = row.workId;
  if (workId == null) {
    workId = await findOrCreateWork({ title: row.title, anilistId: row.anilistId });
    await prisma.publisherEdition.update({
      where: { id: editionId },
      data: { workId },
    });
    console.log(`Work creado/linkeado: #${workId}`);
  }

  const work = await prisma.work.findUnique({
    where: { id: workId },
    select: { author: true, synopsis: true, coverImage: true, anilistId: true },
  });
  if (!work) {
    console.error("Work no encontrado.");
    process.exit(1);
  }

  const patch: { author?: string; synopsis?: string; coverImage?: string } = {};
  if ((force || !work.author) && ed.author?.trim()) patch.author = ed.author.trim();
  if ((force || !work.synopsis) && ed.synopsis?.trim())
    patch.synopsis = ed.synopsis.trim();
  if ((force || !work.coverImage) && ed.cover) patch.coverImage = ed.cover;

  if (!Object.keys(patch).length) {
    console.log("Nada para aplicar (ya estaba todo cargado; usá --force para pisar).");
    return;
  }
  await prisma.work.update({ where: { id: workId }, data: patch });
  console.log(`Aplicado: ${Object.keys(patch).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
