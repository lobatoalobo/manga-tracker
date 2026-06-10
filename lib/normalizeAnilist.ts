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
        role: staff.role,

        name: staff.node.name.full,
      })),

    characters: manga.characters.edges.map((character: any) => ({
      role: character.role,

      name: character.node.name.full,

      image: character.node.image.large,
    })),
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
  const seen = new Set<string>();
  return (links ?? [])
    .filter((l) => l.type === "STREAMING")
    .map((l) => ({ url: l.url, site: l.site, language: l.language ?? null }))
    .filter((l) => {
      const key = `${l.site}|${l.language}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        (LANG_PRIORITY[a.language ?? ""] ?? 9) -
        (LANG_PRIORITY[b.language ?? ""] ?? 9),
    );
}
