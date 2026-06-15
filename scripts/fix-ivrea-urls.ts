/**
 * Arregla las ediciones de Ivrea cuyo link quedó apuntando a Whakoom (sobró del
 * import): construye/valida la URL real de Ivrea (ivrea.com.ar/titulo/<slug>) y,
 * de paso, sincroniza el conteo de tomos desde la ficha de Ivrea (autoritativa).
 *
 *   npx tsx scripts/fix-ivrea-urls.ts [--limit N]   # dry-run
 *   npx tsx scripts/fix-ivrea-urls.ts --apply
 *
 * Las que no resuelven en Ivrea (slug distinto) quedan como están (en ámbar) para
 * corregir a mano. Corre contra DATABASE_URL (.env), throttle con Ivrea.
 */
import { prisma } from "../lib/prisma";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const apply = args.some((a) => a === "--apply" || a === "apply");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) || null : null;

  let rows = await prisma.publisherEdition.findMany({
    where: { publisher: "Ivrea Argentina", url: { contains: "whakoom.com" } },
    select: { id: true, title: true, slug: true, volumes: true, anilistId: true },
  });
  console.log(`Ivrea con link de Whakoom: ${rows.length}`);
  if (limit) rows = rows.slice(0, limit);

  let fixed = 0;
  let failed = 0;
  for (const r of rows) {
    const data = await getIvreaDataBySlug(r.slug).catch(() => null);
    await sleep(400);
    if (!data) {
      console.log(`✗ #${r.id} "${r.title}" (slug "${r.slug}" no resolvió en Ivrea)`);
      failed++;
      continue;
    }
    const newVol =
      data.argentinaVolumes && data.argentinaVolumes > 0
        ? data.argentinaVolumes
        : r.volumes;
    const volNote = newVol !== r.volumes ? ` (tomos ${r.volumes}→${newVol})` : "";
    console.log(`✓ #${r.id} "${r.title}" → ${data.url}${volNote}`);
    if (apply) {
      await prisma.publisherEdition
        .update({ where: { id: r.id }, data: { url: data.url, volumes: newVol } })
        .catch(() => {});
      // Mapeadas: la ficha sale de la caché de ediciones → invalidarla.
      if (r.anilistId)
        await prisma.editionsCache
          .deleteMany({ where: { anilistId: r.anilistId } })
          .catch(() => {});
    }
    fixed++;
  }

  console.log(
    `\n${fixed} con URL de Ivrea${apply ? " (aplicado)" : ""}; ${failed} sin resolver (quedan en ámbar).`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply para guardar.");
  await prisma.$disconnect();
}

main();
