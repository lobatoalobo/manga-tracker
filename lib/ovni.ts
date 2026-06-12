export const OVNI_URL = "https://www.ovnipress.net";

/** URL de búsqueda en el sitio de Ovni Press. */
export function ovniSearchUrl(query: string): string {
  return `${OVNI_URL}/search/?q=${encodeURIComponent(query.trim())}`;
}

/** ¿La URL ya apunta al sitio de Ovni (no a Whakoom / otra fuente)? */
export function isOvniUrl(url: string | null | undefined): boolean {
  return !!url && url.includes("ovnipress.net");
}
