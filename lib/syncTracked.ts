import { prisma } from "@/lib/prisma";

/**
 * Sincroniza `TrackedEdition.totalVolumes` de las colecciones LOCALES (Manga con
 * anilistId negativo = -workId) con el conteo actual del catálogo
 * (`PublisherEdition.volumes`), matcheando por editorial. Así, cuando sale un
 * tomo nuevo (el crawl sube `volumes`), el "te faltan / para comprar" del usuario
 * se actualiza solo. No toca `ownedVolumes`. Devuelve cuántas filas cambió.
 */
export async function syncTrackedTotals(): Promise<number> {
  const mangas = await prisma.manga.findMany({
    where: { anilistId: { lt: 0 } },
    select: {
      anilistId: true,
      editions: { select: { id: true, publisher: true, totalVolumes: true } },
    },
  });
  if (mangas.length === 0) return 0;

  const workIds = [...new Set(mangas.map((m) => -m.anilistId))];
  const cat = await prisma.publisherEdition.findMany({
    where: { workId: { in: workIds } },
    select: { workId: true, publisher: true, volumes: true },
  });
  // workId|publisher -> volumes (catálogo)
  const catVol = new Map<string, number>();
  for (const e of cat)
    if (e.workId != null) catVol.set(`${e.workId}|${e.publisher}`, e.volumes);

  let changed = 0;
  for (const m of mangas) {
    const workId = -m.anilistId;
    for (const te of m.editions) {
      if (!te.publisher) continue;
      const v = catVol.get(`${workId}|${te.publisher}`);
      if (v != null && v > 0 && v !== te.totalVolumes) {
        await prisma.trackedEdition
          .update({ where: { id: te.id }, data: { totalVolumes: v } })
          .catch(() => {});
        changed++;
      }
    }
  }
  return changed;
}
