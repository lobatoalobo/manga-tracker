export const CRUMB_URL = "https://www.crumb.com.ar";

/** Link de búsqueda en Crumb (VTEX full-text). */
export function crumbSearch(title: string): string {
  return `${CRUMB_URL}/${encodeURIComponent(title.trim())}?map=ft`;
}

/** Categorías de manga por editorial en Crumb. */
export const CRUMB_MANGA_CATEGORIES = [
  { label: "Ivrea", path: "/productos/manga/ivrea/" },
  { label: "Panini", path: "/productos/manga/panini-manga/" },
  { label: "Ovni", path: "/productos/manga/ovni/" },
  { label: "Kemuri", path: "/productos/manga/kemuri/" },
  { label: "Moztros", path: "/productos/manga/moztros/" },
  { label: "Utopía", path: "/productos/manga/utopia/" },
  { label: "Distrito Manga", path: "/productos/manga/distrito-manga/" },
  { label: "Planeta", path: "/productos/manga/planeta/" },
  { label: "Merci", path: "/productos/manga/merci/" },
  { label: "Buen Gusto", path: "/productos/manga/buen-gusto/" },
];
