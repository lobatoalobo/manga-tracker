/**
 * Portada = TOMO 1 (anti-spoiler). Whakoom a veces usa como portada de la edición
 * un tomo adelantado; acá forzamos la portada del Work a la del tomo 1, usando el
 * `whakoomComicId` del Volume número 1 (ya guardado) → og:image de su página de
 * comic → R2. Respeta portadas curadas a mano. Corre LOCAL (Whakoom no banea la
 * IP local; sí Ivrea). Throttleado.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/covers-tomo1.ts [--publisher Panini] [--limit N] [--apply]
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { fetchWhakoomHtml } from "../lib/providers/whakoom";
import { storeCover } from "../lib/coverStore";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const apply = process.argv.includes("--apply");
  const publisher = arg("--publisher");
  const limit = Number(arg("--limit")) || 100000;

  // Works (visibles) con un Volume #1 que tenga comicId de Whakoom.
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: {
        type: { not: "COMIC" },
        editions: {
          some: {
            ...(publisher ? { publisher: { contains: publisher } } : {}),
            volumesList: { some: { number: 1, whakoomComicId: { not: null } } },
          },
        },
      },
      select: {
        id: true, title: true, coverImage: true, curated: true,
        editions: {
          select: { publisher: true, volumesList: { where: { number: 1 }, select: { whakoomComicId: true } } },
        },
      },
      take: limit,
      orderBy: { id: "asc" },
    }),
  );

  let changed = 0, same = 0, skipped = 0, failed = 0;
  for (const w of works) {
    if (w.curated.includes("coverImage")) { skipped++; continue; }
    // comicId del tomo 1 (preferir la edición del `publisher` pedido).
    const eds = publisher ? w.editions.filter((e) => e.publisher.includes(publisher)) : w.editions;
    const comicId = eds.flatMap((e) => e.volumesList).map((v) => v.whakoomComicId).find(Boolean)
      ?? w.editions.flatMap((e) => e.volumesList).map((v) => v.whakoomComicId).find(Boolean);
    if (!comicId) { skipped++; continue; }

    const res = await fetchWhakoomHtml(`https://www.whakoom.com/comics/${comicId}`);
    const og = res.ok ? res.html.match(/og:image" content="([^"]+)"/i)?.[1]?.trim() : null;
    if (!og) { failed++; await sleep(700); continue; }

    const url = await storeCover(og);
    if (!url) { failed++; await sleep(700); continue; }
    if (url === w.coverImage) { same++; }
    else {
      if (apply) await dbRetry(() => prisma.work.update({ where: { id: w.id }, data: { coverImage: url } }));
      changed++;
      if (changed <= 30) console.log(`${apply ? "✓" : "[dry]"} #${w.id} "${w.title}" → tomo1`);
    }
    await sleep(700);
  }
  console.log(`\n${apply ? "APLICADO" : "DRY"}: cambiadas ${changed}, ya-tomo1 ${same}, salteadas ${skipped}, fallidas ${failed} (de ${works.length})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
