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
