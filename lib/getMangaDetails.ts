import { cache as reactCache } from "react";
import { getMangaById } from "./anilist";
import { normalizeAnilist } from "./normalizeAnilist";
import { getIvreaEdition } from "./providers/ivrea";
import { getPaniniEdition } from "./providers/panini";
import { getOvniEdition } from "./providers/ovni";
import { getMangaUpdatesData } from "./providers/mangaupdates";
import {
  upsertPublisherEdition,
  linkPublisherEditions,
  slugifyTitle,
  PUBLISHERS,
  type IndexedEdition,
} from "./catalog";
import { buildEditions, type BuiltEditions, type LocalEdition } from "./editions";
import { prisma } from "./prisma";

const EDITIONS_CACHE_TTL = 1000 * 60 * 60 * 24 * 3; // 3 días
// Subir cuando cambie la lógica de resolución: invalida cachés viejas (p. ej.
// para reaplicar la verificación de autor que evita mezclar obras homónimas).
const EDITIONS_CACHE_VERSION = 6;

/** Lo que guardamos en EditionsCache.data: las ediciones + la versión de esquema. */
type CachedEditions = BuiltEditions & { _v?: number };

/** Datos rápidos de AniList (1 request). Para el render inmediato del detalle. */
export async function getMangaCore(id: number) {
  return normalizeAnilist(await getMangaById(id));
}

interface AnilistLike {
  id: number;
  status?: string | null;
  volumes?: number | null;
  staff?: { name: string }[];
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

/**
 * De un conjunto de series, cuáles tienen edición nacional (región AR) según
 * la caché de ediciones. Best-effort: solo mira lo ya cacheado (no scrapea),
 * así que una serie nunca visitada no aparece hasta que se resuelva su detalle.
 */
export async function nationalEditionIds(
  anilistIds: number[],
): Promise<Set<number>> {
  if (anilistIds.length === 0) return new Set();
  try {
    const rows = await prisma.editionsCache.findMany({
      where: { anilistId: { in: anilistIds } },
      select: { anilistId: true, data: true },
    });
    return new Set(
      rows
        .filter((r) => {
          const data = r.data as unknown as CachedEditions;
          // Solo confiamos en cachés de la versión actual (las viejas pueden
          // tener una edición nacional mal matcheada por homonimia).
          if (data?._v !== EDITIONS_CACHE_VERSION) return false;
          return (data.editions ?? []).some((e) => e.region === "AR");
        })
        .map((r) => r.anilistId),
    );
  } catch {
    return new Set();
  }
}

async function getEditionsCache(
  anilistId: number,
): Promise<BuiltEditions | null> {
  try {
    const row = await prisma.editionsCache.findUnique({
      where: { anilistId },
    });
    if (!row) return null;
    const data = row.data as unknown as CachedEditions;
    if (data?._v !== EDITIONS_CACHE_VERSION) return null;
    if (Date.now() - row.updatedAt.getTime() > EDITIONS_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveEditionsCache(anilistId: number, built: BuiltEditions) {
  try {
    const data = { ...built, _v: EDITIONS_CACHE_VERSION } as unknown as object;
    await prisma.editionsCache.upsert({
      where: { anilistId },
      update: { data },
      create: { anilistId, data },
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
  const authors = (anilist.staff ?? []).map((s) => s.name).filter(Boolean);

  // 1) Ediciones nacionales desde el MAPEO VERIFICADO (anilistId), no por
  //    título: así no se mezclan obras homónimas y es consistente con el badge.
  const mappedRows = await prisma.publisherEdition.findMany({
    where: { anilistId: anilist.id },
  });
  const byPub = new Map<string, IndexedEdition>(
    mappedRows
      .filter((e) => e.volumes > 0)
      .map((e) => [
        e.publisher,
        {
          publisher: e.publisher,
          slug: e.slug,
          title: e.title,
          volumes: e.volumes,
          status: e.status,
          url: e.url,
        },
      ]),
  );

  // 2) Fallback en vivo (verificado por autor) para editoriales SIN mapeo + MU.
  const tasks: Promise<void>[] = [];

  if (!byPub.has("Ivrea Argentina")) {
    tasks.push(
      getIvreaEdition(titles, knownSlug, authors)
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
  // Panini no expone el autor en su tienda (ni en atributos ni en JSON-LD),
  // así que su match queda solo por título: no se puede verificar por autor.
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
      getOvniEdition(titles, authors)
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

  // Backfill del anilistId para las que se resolvieron en vivo (verificadas por
  // autor), así la próxima salen del mapeo y aparecen también en el badge/browse.
  void linkPublisherEditions(
    anilist.id,
    [...byPub.values()].map((e) => ({ publisher: e.publisher, title: e.title })),
  ).catch(() => {});

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
