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
 * true). Bloquea solo ante un desajuste claro. Es robusto a strings con ruido
 * (algunas tiendas pegan la sinopsis al nombre del autor): compara por tokens
 * "sustanciales" (apellido/nombre, len ≥ 4) en vez de exigir el string completo.
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
  const seriesTokens = [...series];

  // Señal fuerte: un token sustancial del autor (len ≥ 4) coincide con algún
  // token de la serie por SUBSTRING. El substring tolera dos cosas comunes:
  // romanización ("Eiichiro" ⊂ "Eiichirou") y concatenación ("Aida" ⊂ "AidaIro").
  const matchSub = (t: string) =>
    seriesTokens.some((s) => s.includes(t) || t.includes(s));
  const pubSub = pub.filter((t) => t.length >= 4);
  if (pubSub.some(matchSub)) return true;

  // Si ambos lados tienen tokens sustanciales y ninguno coincide, son autores
  // distintos → bloquea (caso homónimo).
  const seriesHasSub = seriesTokens.some((t) => t.length >= 4);
  if (pubSub.length > 0 && seriesHasSub) return false;

  // Nombres muy cortos (sin tokens sustanciales): basta un token compartido.
  return pub.some((t) => series.has(t));
}
