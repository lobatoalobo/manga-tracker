export const LAREVISTERIA_URL = "https://www.larevisteria.com";

/** URL de búsqueda en La Revistería (retailer que vende todas las editoriales). */
export function laRevisteriaSearch(query: string): string {
  return `${LAREVISTERIA_URL}/search?q=${encodeURIComponent(query.trim())}`;
}
