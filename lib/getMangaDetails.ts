import { getMangaById } from "./anilist";
import { normalizeAnilist } from "./normalizeAnilist";
import { getIvreaEdition } from "./providers/ivrea";
import { getPaniniEdition } from "./providers/panini";
import { getMangaUpdatesData } from "./providers/mangaupdates";
import { buildEditions } from "./editions";

export async function getMangaDetails(id: number, knownSlug?: string | null) {
  const raw = await getMangaById(id);

  const anilist = normalizeAnilist(raw);

  const titles = [anilist.title.english, anilist.title.romaji].filter(
    (t): t is string => Boolean(t),
  );

  // Resolvemos editoriales locales y MangaUpdates en paralelo.
  const [edition, panini, mu] = await Promise.all([
    getIvreaEdition(titles, knownSlug).catch(() => null),
    getPaniniEdition(titles).catch(() => null),
    getMangaUpdatesData(titles, { expectedVolumes: anilist.volumes }).catch(
      () => null,
    ),
  ]);

  // `edition` = edición local primaria (Ivrea) para resolver el slug guardado.
  // `editions` = todas las ediciones (locales + formatos) para el detalle.
  // `muVolumes` = total estándar autoritativo para trackear.
  const { editions, muVolumes } = buildEditions(anilist, edition, panini, mu);

  return {
    anilist,
    edition,
    editions,
    muVolumes,
  };
}
