function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * ¿El autor que lista la editorial coincide con los autores de la serie
 * (según AniList)? Sirve para no mezclar obras homónimas de distintos autores
 * (p. ej. "Real" de Takehiko Inoue vs. otra serie también llamada "Real").
 *
 * Conservador: si no se puede parsear autor de algún lado, NO bloquea (devuelve
 * true). Bloquea solo ante un desajuste claro: que menos de la mitad de los
 * tokens del autor de la editorial aparezcan entre los autores de la serie.
 */
export function authorMatches(
  seriesAuthors: string[],
  publisherAuthor: string | null | undefined,
): boolean {
  if (!publisherAuthor) return true;
  const pub = tokenize(publisherAuthor);
  if (pub.length === 0) return true;

  const series = new Set(seriesAuthors.flatMap(tokenize));
  if (series.size === 0) return true;

  const hits = pub.filter((t) => series.has(t)).length;
  return hits / pub.length >= 0.5;
}
