import { getMangaById } from "./anilist";
import { normalizeAnilist } from "./normalizeAnilist";
import { getIvreaEdition } from "./providers/ivrea";
import { getPaniniEdition } from "./providers/panini";
import { getOvniEdition } from "./providers/ovni";
import { getMangaUpdatesData } from "./providers/mangaupdates";
import { buildEditions, type BuiltEditions } from "./editions";

/** Datos rápidos de AniList (1 request). Para el render inmediato del detalle. */
export async function getMangaCore(id: number) {
  return normalizeAnilist(await getMangaById(id));
}

interface AnilistLike {
  status?: string | null;
  volumes?: number | null;
}

/**
 * Resuelve las ediciones consultando todas las editoriales + MangaUpdates en
 * paralelo. Es la parte lenta (scraping); conviene streamearla con <Suspense>.
 */
export async function resolveEditions(
  anilist: AnilistLike,
  titles: string[],
  knownSlug?: string | null,
): Promise<BuiltEditions> {
  const [edition, panini, ovni, mu] = await Promise.all([
    getIvreaEdition(titles, knownSlug).catch(() => null),
    getPaniniEdition(titles).catch(() => null),
    getOvniEdition(titles).catch(() => null),
    getMangaUpdatesData(titles, { expectedVolumes: anilist.volumes }).catch(
      () => null,
    ),
  ]);

  return buildEditions(anilist, edition, panini, ovni, mu);
}

/** Conveniencia (scripts/seed): combina core + ediciones. */
export async function getMangaDetails(id: number, knownSlug?: string | null) {
  const anilist = await getMangaCore(id);
  const titles = titlesOf(anilist);
  const { editions, muVolumes } = await resolveEditions(
    anilist,
    titles,
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
