/**
 * Rellena `Work.author` (y autor de paso portada/sinopsis si faltan) de las obras
 * que tienen edición de Ivrea pero quedaron sin autor, releyendo la ficha con el
 * parser actual. Solo completa lo que falte (no pisa).
 *
 *   node scripts/with-staging.mjs npx tsx scripts/backfill-ivrea-authors.ts [--dry]
 */
import { prisma } from "../lib/prisma";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dry = process.argv.includes("--dry");
  const works = await prisma.work.findMany({
    where: { author: null, editions: { some: { publisher: "Ivrea Argentina" } } },
    select: {
      id: true,
      title: true,
      coverImage: true,
      synopsis: true,
      editions: {
        where: { publisher: "Ivrea Argentina" },
        select: { slug: true },
        take: 1,
      },
    },
  });
  console.log(`${works.length} works de Ivrea sin autor.\n`);

  let filled = 0;
  for (const w of works) {
    const slug = w.editions[0]?.slug;
    if (!slug) continue;
    const d = await getIvreaDataBySlug(slug).catch(() => null);
    await sleep(400);
    if (!d?.author) continue;
    filled++;
    console.log(`  ${w.title} → ${d.author}`);
    if (!dry) {
      const patch: { author?: string; coverImage?: string; synopsis?: string } = {
        author: d.author,
      };
      if (!w.coverImage && d.coverImage) patch.coverImage = d.coverImage;
      if (!w.synopsis && d.synopsis) patch.synopsis = d.synopsis;
      await prisma.work.update({ where: { id: w.id }, data: patch });
    }
  }
  console.log(`\n${dry ? "[DRY] " : ""}Con autor encontrado: ${filled}/${works.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
