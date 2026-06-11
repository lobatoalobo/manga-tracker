import { cache as reactCache } from "react";
import { getMangaById } from "./anilist";
import { normalizeAnilist } from "./normalizeAnilist";
import { getIvreaEdition } from "./providers/ivrea";
import { getPaniniEdition } from "./providers/panini";
import { getOvniEdition } from "./providers/ovni";
import { getMangaUpdatesData } from "./providers/mangaupdates";
import {
  lookupEditions,
  upsertPublisherEdition,
  slugifyTitle,
  PUBLISHERS,
  type IndexedEdition,
} from "./catalog";
import { buildEditions, type BuiltEditions, type LocalEdition } from "./editions";
import { prisma } from "./prisma";

const EDITIONS_CACHE_TTL = 1000 * 60 * 60 * 24 * 3; // 3 días

/** Datos rápidos de AniList (1 request). Para el render inmediato del detalle. */
export async function getMangaCore(id: number) {
  return normalizeAnilist(await getMangaById(id));
}

interface AnilistLike {
  id: number;
  status?: string | null;
  volumes?: number | null;
}

const PUBLISHER_ID: Record<string, string> = {
  "Ivrea Argentina": "ivrea",
  "Panini Argentina": "panini",
  "Ovni Press": "ovni",
};

/**
 * Resuelve las ediciones. Primero busca en el índice (rápido); para las
 * editoriales que no estén, scrapea en vivo y las cachea en el índice.
 * MangaUpdates se consulta siempre en vivo (formatos).
 */
export const resolveEditions = reactCache(async function resolveEditions(
  anilist: AnilistLike,
  titles: string[],
  knownSlug?: string | null,
): Promise<BuiltEditions> {
  // Caché por serie: la primera vez resuelve en vivo; después es instantáneo.
  const cached = await getEditionsCache(anilist.id);
  if (cached) return cached;

  const built = await resolveEditionsLive(anilist, titles, knownSlug);
  await saveEditionsCache(anilist.id, built);
  return built;
});

async function getEditionsCache(
  anilistId: number,
): Promise<BuiltEditions | null> {
  try {
    const row = await prisma.editionsCache.findUnique({
      where: { anilistId },
    });
    if (!row) return null;
    if (Date.now() - row.updatedAt.getTime() > EDITIONS_CACHE_TTL) return null;
    return row.data as unknown as BuiltEditions;
  } catch {
    return null;
  }
}

async function saveEditionsCache(anilistId: number, built: BuiltEditions) {
  try {
    await prisma.editionsCache.upsert({
      where: { anilistId },
      update: { data: built as unknown as object },
      create: { anilistId, data: built as unknown as object },
    });
  } catch {
    /* best-effort */
  }
}

async function resolveEditionsLive(
  anilist: AnilistLike,
  titles: string[],
  knownSlug?: string | null,
): Promise<BuiltEditions> {
  // 1) Índice.
  const indexed = await lookupEditions(titles);
  const byPub = new Map<string, IndexedEdition>(
    indexed.map((e) => [e.publisher, e]),
  );

  // 2) Fallback en vivo (en paralelo) para editoriales faltantes + MU.
  const tasks: Promise<void>[] = [];

  if (!byPub.has("Ivrea Argentina")) {
    tasks.push(
      getIvreaEdition(titles, knownSlug)
        .then((d) => {
          if (d && d.argentinaVolumes > 0)
            cache(byPub, {
              publisher: "Ivrea Argentina",
              slug: d.slug,
              title: d.title || titles[0],
              volumes: d.argentinaVolumes,
              status: d.argentinaStatus,
              url: d.url,
            });
        })
        .catch(() => {}),
    );
  }
  if (!byPub.has("Panini Argentina")) {
    tasks.push(
      getPaniniEdition(titles)
        .then((d) => {
          if (d && d.totalVolumes > 0)
            cache(byPub, {
              publisher: "Panini Argentina",
              slug: slugifyTitle(titles[0]),
              title: titles[0],
              volumes: d.totalVolumes,
              status: "EN CATÁLOGO",
              url: d.url,
            });
        })
        .catch(() => {}),
    );
  }
  if (!byPub.has("Ovni Press")) {
    tasks.push(
      getOvniEdition(titles)
        .then((d) => {
          if (d && d.totalVolumes > 0)
            cache(byPub, {
              publisher: "Ovni Press",
              slug: slugifyTitle(titles[0]),
              title: titles[0],
              volumes: d.totalVolumes,
              status: "EN CATÁLOGO",
              url: d.url,
            });
        })
        .catch(() => {}),
    );
  }

  const muPromise = getMangaUpdatesData(titles, {
    expectedVolumes: anilist.volumes,
  }).catch(() => null);

  await Promise.all(tasks);
  const mu = await muPromise;

  // 3) Lista uniforme de ediciones locales.
  const local: LocalEdition[] = PUBLISHERS.filter((p) => byPub.has(p)).map(
    (p) => {
      const e = byPub.get(p)!;
      return {
        id: PUBLISHER_ID[p],
        publisher: p,
        slug: e.slug,
        volumes: e.volumes,
        status: e.status ?? "EN CATÁLOGO",
        url: e.url,
        note: e.status === "EN CATÁLOGO" ? "según catálogo de la editorial" : undefined,
      };
    },
  );

  return buildEditions(anilist, local, mu);
}

/** Agrega al mapa en memoria y persiste en el índice (best-effort). */
function cache(
  byPub: Map<string, IndexedEdition>,
  e: IndexedEdition & { title: string },
): void {
  byPub.set(e.publisher, e);
  void upsertPublisherEdition(e).catch(() => {});
}

/** Conveniencia (scripts/seed): combina core + ediciones. */
export async function getMangaDetails(id: number, knownSlug?: string | null) {
  const anilist = await getMangaCore(id);
  const { editions, muVolumes } = await resolveEditions(
    anilist,
    titlesOf(anilist),
    knownSlug,
  );
  return { anilist, editions, muVolumes };
}

export function titlesOf(anilist: {
  title: { english?: string | null; romaji?: string | null };
}): string[] {
  return [anilist.title.english, anilist.title.romaji].filter(
    (t): t is string => Boolean(t),
  );
}
