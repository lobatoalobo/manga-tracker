/**
 * Rellena Work.coverImage desde AniList para los works MAPEADOS que no tienen
 * portada (p. ej. los de Ivrea que entraron por crawl y nunca pasaron por
 * Whakoom). Así la mini-portada aparece también en la tab Editoriales / búsqueda.
 *
 *   npx tsx scripts/enrich-covers.ts
 *
 * Corre contra DATABASE_URL (.env). Es enriquecimiento OFFLINE (no runtime):
 * snapshotea la portada de AniList a nuestra DB. Batchea de a 50 (límite de la
 * query) con throttle para no pegarle de más a AniList.
 */
import { prisma } from "../lib/prisma";
import { getMangaCovers } from "../lib/anilist";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const works = await prisma.work.findMany({
    where: { anilistId: { not: null }, coverImage: null },
    select: { id: true, anilistId: true },
  });
  console.log(`Works mapeados sin portada: ${works.length}`);

  let done = 0;
  for (let i = 0; i < works.length; i += 50) {
    const batch = works.slice(i, i + 50);
    const ids = batch
      .map((w) => w.anilistId)
      .filter((n): n is number => n != null);
    const covers = await getMangaCovers(ids).catch(() => new Map<number, string>());

    for (const w of batch) {
      const url = w.anilistId != null ? covers.get(w.anilistId) : null;
      if (url) {
        await prisma.work
          .update({ where: { id: w.id }, data: { coverImage: url } })
          .catch(() => {});
        done++;
      }
    }
    console.log(`  ${Math.min(i + 50, works.length)}/${works.length} (portadas: ${done})`);
    await sleep(900);
  }

  console.log(`Listo: ${done} portadas seteadas desde AniList.`);
  await prisma.$disconnect();
}

main();
