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
export const EDITIONS_CACHE_VERSION = 10;

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

/** Borra la caché de ediciones de una serie para forzar re-resolución. */
export async function invalidateEditionsCache(anilistId: number) {
  await prisma.editionsCache
    .deleteMany({ where: { anilistId } })
    .catch(() => {});
}

/** Vacía toda la caché de ediciones (admin). Devuelve cuántas borró. */
export async function clearAllEditionsCache(): Promise<number> {
  const r = await prisma.editionsCache.deleteMany({});
  return r.count;
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
  const [mappedRows, exclusionRows] = await Promise.all([
    prisma.publisherEdition.findMany({
      where: { anilistId: anilist.id },
      include: { work: { select: { upcoming: true } } },
    }),
    prisma.editionExclusion.findMany({ where: { anilistId: anilist.id } }),
  ]);
  // Editoriales desvinculadas a mano de esta serie: ni se muestran ni se
  // re-enganchan en vivo (p. ej. ids duplicados de AniList con mismo título).
  const excluded = new Set(exclusionRows.map((e) => e.publisher));
  // Puede haber varias ediciones por editorial (regular + deluxe/kanzenban).
  // Las "próximo a salir" se muestran aunque tengan 0 tomos (preventa AR).
  const all: IndexedEdition[] = mappedRows
    .filter(
      (e) =>
        (e.volumes > 0 || e.work?.upcoming) && !excluded.has(e.publisher),
    )
    .map((e) => ({
      publisher: e.publisher,
      slug: e.slug,
      title: e.title,
      volumes: e.volumes,
      status: e.status,
      url: e.url,
    }));
  const mappedPubs = new Set(all.map((e) => e.publisher));
  const live: IndexedEdition[] = [];
  const addLive = (e: IndexedEdition) => {
    all.push(e);
    live.push(e);
    void upsertPublisherEdition(e).catch(() => {});
  };

  // 2) Fallback en vivo (verificado por autor) para editoriales SIN mapeo + MU.
  const tasks: Promise<void>[] = [];

  if (!mappedPubs.has("Ivrea Argentina") && !excluded.has("Ivrea Argentina")) {
    tasks.push(
      getIvreaEdition(titles, knownSlug, authors)
        .then((d) => {
          if (d && d.argentinaVolumes > 0)
            addLive({
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
  if (!mappedPubs.has("Panini Argentina") && !excluded.has("Panini Argentina")) {
    tasks.push(
      getPaniniEdition(titles)
        .then((d) => {
          if (d && d.totalVolumes > 0)
            addLive({
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
  if (!mappedPubs.has("Ovni Press") && !excluded.has("Ovni Press")) {
    tasks.push(
      getOvniEdition(titles, authors)
        .then((d) => {
          if (d && d.totalVolumes > 0)
            addLive({
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
    live.map((e) => ({ publisher: e.publisher, title: e.title })),
  ).catch(() => {});

  // 3) Lista uniforme de ediciones locales. Soporta varias por editorial: la de
  //    más tomos conserva la clave canónica ("ivrea"); las extra (deluxe) llevan
  //    una clave única para poder trackearlas por separado.
  const byPublisher = new Map<string, IndexedEdition[]>();
  for (const e of all) {
    const arr = byPublisher.get(e.publisher) ?? [];
    arr.push(e);
    byPublisher.set(e.publisher, arr);
  }
  const local: LocalEdition[] = [];
  for (const p of PUBLISHERS) {
    const list = byPublisher.get(p);
    if (!list) continue;
    list.sort((a, b) => b.volumes - a.volumes);
    list.forEach((e, i) => {
      local.push({
        id: i === 0 ? PUBLISHER_ID[p] : `${PUBLISHER_ID[p]}__${e.slug}`,
        publisher: p,
        label: list.length > 1 ? `${p} · ${e.title}` : p,
        slug: e.slug,
        volumes: e.volumes,
        status: e.status ?? "EN CATÁLOGO",
        url: e.url,
        note:
          e.status === "EN CATÁLOGO" ? "según catálogo de la editorial" : undefined,
      });
    });
  }

  return buildEditions(anilist, local, mu);
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
