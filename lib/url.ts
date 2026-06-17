/**
 * Convierte un valor ingresado por el usuario (web o red social) en un href
 * absoluto. Evita que valores como "tienda.com.ar" o "@usuario" se traten como
 * links relativos del propio sitio.
 */
/**
 * Link a la ficha de una serie. Las obras del catálogo local (sin AniList) usan
 * un id negativo (-workId) y viven en /serie/[workId]; el resto en
 * /manga/[anilistId].
 */
export function seriesHref(anilistId: number): string {
  return anilistId < 0 ? `/serie/${-anilistId}` : `/manga/${anilistId}`;
}

export function externalHref(value: string): string {
  const t = value.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("@")) return `https://instagram.com/${t.slice(1)}`;
  return `https://${t.replace(/^\/+/, "")}`;
}
