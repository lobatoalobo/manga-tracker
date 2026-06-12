import { prisma } from "@/lib/prisma";

export interface SeriesInspection {
  anilistId: number;
  title: string | null;
  editions: {
    id: number;
    publisher: string;
    title: string;
    volumes: number;
    status: string | null;
    url: string;
  }[];
  crumbOverride: string | null;
  cache: { exists: boolean; updatedAt: Date | null; version: number | null };
}

/** Datos crudos de una serie para debug (sin pasar por la caché de ediciones). */
export async function inspectSeries(
  anilistId: number,
): Promise<SeriesInspection> {
  const [editions, crumb, cache] = await Promise.all([
    prisma.publisherEdition.findMany({
      where: { anilistId },
      orderBy: [{ publisher: "asc" }, { volumes: "desc" }],
      select: {
        id: true,
        publisher: true,
        title: true,
        volumes: true,
        status: true,
        url: true,
      },
    }),
    prisma.crumbMapping.findUnique({ where: { anilistId } }),
    prisma.editionsCache.findUnique({ where: { anilistId } }),
  ]);

  // El título lo sacamos de la colección de cualquier usuario que la tenga
  // (evita pegarle a AniList sólo para el debug).
  const manga = await prisma.manga.findFirst({
    where: { anilistId },
    select: { romajiTitle: true, englishTitle: true },
  });
  const title =
    manga?.englishTitle || manga?.romajiTitle || editions[0]?.title || null;

  const cacheData = cache?.data as { _v?: number } | null;

  return {
    anilistId,
    title,
    editions,
    crumbOverride: crumb?.query ?? null,
    cache: {
      exists: !!cache,
      updatedAt: cache?.updatedAt ?? null,
      version: cacheData?._v ?? null,
    },
  };
}
