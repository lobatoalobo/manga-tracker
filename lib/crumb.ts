export const CRUMB_URL = "https://www.crumb.com.ar";

/** Link de búsqueda filtrada en el catálogo de Crumb. */
export function crumbSearch(title: string): string {
  return `${CRUMB_URL}/productos/?filter=${encodeURIComponent(
    title.trim(),
  )}&order=0&view=1`;
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
