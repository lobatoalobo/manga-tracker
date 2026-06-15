/**
 * Auto-mapea a AniList las ediciones SIN mapear (versión batch del botón "Auto").
 * Usa la misma resolución robusta: nombre original japonés de la ficha + autor.
 * Las que resuelven pasan a tener anilistId → su ficha es /manga con géneros,
 * score, etc. (deja de ser /nacional). Las que no, quedan nacionales.
 *
 *   npx tsx scripts/auto-map.ts [--limit N]   # dry-run (muestra qué mapearía)
 *   npx tsx scripts/auto-map.ts --apply
 *
 * Procesa Ivrea primero (resuelve mejor: su ficha trae romaji + autor). Lento
 * (pega a AniList + fichas), throttle; corré con --limit para probar de a poco.
 */
import { prisma } from "../lib/prisma";
import { resolveEditionSeries } from "../lib/resolveSeries";
import { findOrCreateWork, setEditionAnilistId } from "../lib/catalog";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const apply = args.some((a) => a === "--apply" || a === "apply");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) || null : null;
  const pubArg = args.find((a) => ["ivrea", "panini", "ovni"].includes(a));
  const publisher = pubArg
    ? { ivrea: "Ivrea Argentina", panini: "Panini Argentina", ovni: "Ovni Press" }[pubArg]
    : undefined;

  let rows = await prisma.publisherEdition.findMany({
    where: { anilistId: null, nationalOnly: false, ...(publisher ? { publisher } : {}) },
    select: { id: true, publisher: true, slug: true, title: true },
    orderBy: { publisher: "asc" }, // Ivrea primero
  });
  console.log(`Sin mapear: ${rows.length}`);
  if (limit) rows = rows.slice(0, limit);

  let mapped = 0;
  let skipped = 0;
  for (const r of rows) {
    const anilistId = await resolveEditionSeries({
      publisher: r.publisher,
      slug: r.slug,
      title: r.title,
    }).catch(() => null);
    await sleep(800);

    if (!anilistId) {
      skipped++;
      continue;
    }
    console.log(`✓ #${r.id} "${r.title}" [${r.publisher}] → AniList ${anilistId}`);
    if (apply) {
      await setEditionAnilistId(r.id, anilistId);
      const workId = await findOrCreateWork({ title: r.title, anilistId }).catch(() => null);
      if (workId)
        await prisma.publisherEdition.update({ where: { id: r.id }, data: { workId } });
      await prisma.editionsCache.deleteMany({ where: { anilistId } }).catch(() => {});
    }
    mapped++;
  }

  console.log(
    `\n${mapped} mapeadas${apply ? " (aplicado)" : ""}; ${skipped} sin resolver (quedan nacionales).`,
  );
  if (!apply) console.log("DRY-RUN: revisá los matches y corré con --apply.");
  await prisma.$disconnect();
}

main();
