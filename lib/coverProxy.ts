/**
 * MangaDex bloquea el hotlinking de portadas (rechaza el Referer de otros
 * dominios → ícono roto en el navegador). Servir esas portadas por un proxy
 * propio (mismo origen, sin referer) las arregla. Esta función reescribe las
 * URLs de `uploads.mangadex.org` a `/api/cover?u=…`; el resto pasa igual.
 */
export function proxiedCover(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    if (new URL(url).hostname === "uploads.mangadex.org") {
      return `/api/cover?u=${encodeURIComponent(url)}`;
    }
  } catch {
    // URL inválida → la devolvemos tal cual.
  }
  return url;
}
