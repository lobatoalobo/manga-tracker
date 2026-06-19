const BASE = "https://www.googleapis.com/books/v1/volumes";

// Google Books topea en ~100 ítems reales por query (aunque diga totalItems=300).
// Para romper ese techo corremos VARIAS queries que sesgan distintas porciones
// del catálogo y unimos: relevance + newest + cortes por género + imprints.
const QUERIES = [
  { q: 'inpublisher:"VIZ Media"', order: "relevance" },
  { q: 'inpublisher:"VIZ Media"', order: "newest" },
  { q: 'inpublisher:"VIZ Media" shonen', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" shojo', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" seinen', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" romance', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" horror', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" fantasy', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" action', order: "relevance" },
  { q: 'inpublisher:"VIZ Media" comedy', order: "relevance" },
  { q: 'inpublisher:"VIZ Media LLC"', order: "newest" },
  { q: 'inpublisher:"Shonen Jump"', order: "relevance" },
  { q: 'inpublisher:"VIZ Signature"', order: "relevance" },
] as const;

// Títulos que NO son una serie de manga (artbooks, novelas, guías, ediciones).
const NOISE =
  /\bart\s?book\b|^the art of|\b(light\s)?novel\b|\bnovelization\b|box set|coloring book|\bguide\b|fan ?book|character book|illustration|sticker|calendar|coloring|profiles|data ?book|^making of/i;

/**
 * Enumera series de VIZ vía Google Books. GB lista por editorial (`inpublisher`)
 * pero da TOMOS sueltos, no series: limpiamos ("Naruto, Vol. 7" → "Naruto"),
 * filtramos ruido (artbooks/novelas) y deduplicamos. Best-effort: cada título se
 * VERIFICA después contra MU. Requiere GOOGLE_BOOKS_API_KEY. null si falta la key.
 */
export async function googleBooksVizTitles(
  pagesPerQuery = 5,
): Promise<string[] | null> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return null;

  const seen = new Map<string, string>(); // normalizado → título limpio
  for (const { q, order } of QUERIES) {
    for (let page = 0; page < pagesPerQuery; page++) {
      const url =
        `${BASE}?q=${encodeURIComponent(q)}` +
        `&maxResults=40&startIndex=${page * 40}&orderBy=${order}` +
        `&country=US&key=${key}`;
      const r = await fetch(url).catch(() => null);
      if (!r || !r.ok) break;
      const json = await r.json().catch(() => null);
      const items: { volumeInfo?: { title?: string; publisher?: string } }[] =
        json?.items ?? [];
      if (items.length === 0) break;

      for (const it of items) {
        const vi = it.volumeInfo;
        if (!vi?.title) continue;
        if (vi.publisher && !/viz/i.test(vi.publisher)) continue; // inpublisher es laxo
        if (NOISE.test(vi.title)) continue;
        const title = seriesTitle(vi.title);
        if (!title || title.length < 2 || NOISE.test(title)) continue;
        const norm = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (!seen.has(norm)) seen.set(norm, title);
      }
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  return [...seen.values()];
}

/** "Naruto, Vol. 7: The Path" / "Bleach, Vol. 1" / "X (Omnibus)" → serie. */
function seriesTitle(raw: string): string {
  let t = raw.trim();
  // Corta en ", Vol. N" / ": Volume N" / ", Book N" / ", Tome N" y lo que sigue.
  t = t.replace(/[,:]?\s*(vol\.?|volume|book|tome|gn|tp|part)\s*\.?\s*\d+.*$/i, "");
  // Corta "#N" final.
  t = t.replace(/\s*#\s*\d+.*$/, "");
  // Saca paréntesis de edición al final: "(Omnibus)", "(3-in-1 Edition)",
  // "(Color Edition)", "(Yaoi Manga)", "(Manga)".
  t = t.replace(
    /\s*\((?:[^)]*\b(?:edition|omnibus|manga|deluxe|collector'?s|color|colour|complete|box)\b[^)]*)\)\s*$/i,
    "",
  );
  return t.replace(/[\s,:;-]+$/, "").trim();
}
