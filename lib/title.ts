/**
 * Título a mostrar al usuario. AniList no expone título en español, así que
 * preferimos el inglés (suele ser el nombre con el que se conoce/edita la obra
 * acá, p. ej. "Go! Go! Loser Ranger!") sobre el romaji japonés
 * ("Sentai Daishikkaku"). Cae a romaji y luego a nativo.
 */
export function displayTitle(title: {
  english?: string | null;
  romaji?: string | null;
  native?: string | null;
}): string {
  return title.english || title.romaji || title.native || "";
}

/** Normaliza un título para comparar por nombre (sin tildes ni puntuación). */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** ¿La búsqueda coincide exactamente con alguno de los títulos de la serie? */
export function isExactTitleMatch(
  title: { english?: string | null; romaji?: string | null; native?: string | null },
  query: string,
): boolean {
  const q = normalizeTitle(query);
  if (!q) return false;
  return [title.english, title.romaji, title.native].some(
    (t) => t && normalizeTitle(t) === q,
  );
}
