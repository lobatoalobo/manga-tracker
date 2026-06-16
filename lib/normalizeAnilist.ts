import { cleanDescription } from "./cleanDescription";

export function normalizeAnilist(manga: any) {
  return {
    id: manga.id,

    title: manga.title,

    coverImage: manga.coverImage.extraLarge,

    bannerImage: manga.bannerImage,

    description: cleanDescription(manga.description),

    genres: manga.genres,

    averageScore: manga.averageScore,

    popularity: manga.popularity,

    favourites: manga.favourites,

    format: manga.format,

    status: manga.status,

    isAdult: manga.isAdult ?? false,

    volumes: manga.volumes,

    chapters: manga.chapters,

    country: manga.countryOfOrigin,

    readingLinks: readingLinks(manga.externalLinks),

    startDate: manga.startDate,

    staff: manga.staff.edges
      .filter(
        (staff: any) =>
          staff.role === "Story & Art" ||
          staff.role === "Story" ||
          staff.role === "Art",
      )
      .map((staff: any) => ({
        id: staff.node.id,
        role: staff.role,

        name: staff.node.name.full,
      })),

    // Asistentes (ayudantes de la obra): el rol de AniList contiene "Assistant"
    // (p. ej. Gege Akutami fue asistente en "Kiss x Death").
    assistants: manga.staff.edges
      .filter((staff: any) => /assistant/i.test(staff.role ?? ""))
      .map((staff: any) => ({
        id: staff.node.id,
        role: staff.role,
        name: staff.node.name.full,
      })),

    characters: manga.characters.edges.map((character: any) => ({
      role: character.role,

      name: character.node.name.full,

      image: character.node.image.large,
    })),

    // Obras relacionadas (secuelas, spin-offs, adaptación a anime, etc.).
    relations: (manga.relations?.edges ?? [])
      .map((e: any) => ({
        relationType: e.relationType as string,
        id: e.node.id as number,
        mediaType: e.node.type as string, // MANGA | ANIME
        format: e.node.format as string | null,
        title: e.node.title as {
          romaji?: string | null;
          english?: string | null;
          native?: string | null;
        },
        coverImage: e.node.coverImage?.large ?? null,
        isAdult: e.node.isAdult ?? false,
      }))
      // Solo manga/anime, y NUNCA relacionados hentai/R18 (bloqueo total).
      .filter(
        (r: any) =>
          (r.mediaType === "MANGA" || r.mediaType === "ANIME") && !r.isAdult,
      ),
  };
}

export interface ReadingLink {
  url: string;
  site: string;
  language: string | null;
}

// Idiomas que nos interesan primero (lector argentino).
const LANG_PRIORITY: Record<string, number> = {
  Spanish: 0,
  English: 1,
  Japanese: 2,
};

/**
 * Links de lectura oficiales (de las editoriales/plataformas), curados por
 * AniList. Solo `type: STREAMING` (lectores), priorizando español e inglés.
 * Son lectores legales (MANGA Plus, VIZ, etc.); no hosteamos nada.
 */
function readingLinks(links: any[] | null | undefined): ReadingLink[] {
  const seenUrl = new Set<string>();
  const seenSiteLang = new Set<string>();

  return (links ?? [])
    .filter((l) => l.type === "STREAMING")
    .map((l) => ({ url: l.url, site: l.site, language: l.language ?? null }))
    // Dedup respetando el orden de AniList:
    //  - por URL: a veces AniList repite la misma URL en dos idiomas (dato
    //    erróneo, p. ej. español y alemán apuntando al mismo título). Nos
    //    quedamos con la primera para no mostrar un link mal etiquetado.
    //  - por sitio+idioma: evita el mismo lector/idioma duplicado.
    .filter((l) => {
      const siteLang = `${l.site}|${l.language}`;
      if (seenUrl.has(l.url) || seenSiteLang.has(siteLang)) return false;
      seenUrl.add(l.url);
      seenSiteLang.add(siteLang);
      return true;
    })
    .sort(
      (a, b) =>
        (LANG_PRIORITY[a.language ?? ""] ?? 9) -
        (LANG_PRIORITY[b.language ?? ""] ?? 9),
    );
}
