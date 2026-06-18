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

/**
 * Normaliza y VALIDA una URL ingresada por la comunidad (portada, tienda, red).
 * Devuelve la URL http(s) normalizada o `null` si no es válida. Rechaza esquemas
 * peligrosos/no-web (`javascript:`, `data:`, `file:`, etc.) que podrían usarse
 * para XSS, tracking o contenido no permitido. Pensado para usar tanto al
 * guardar (validar) como al renderizar (defensa en profundidad).
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(externalHref(raw));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null; // descarta hosts sin TLD
    return url.toString();
  } catch {
    return null;
  }
}
