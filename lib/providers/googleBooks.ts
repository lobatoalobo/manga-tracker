const BASE = "https://www.googleapis.com/books/v1/volumes";

/**
 * Enumeración de series de VIZ vía Google Books. GB es la única fuente que
 * permite listar por editorial (`inpublisher`), pero da TOMOS sueltos, no
 * series: limpiamos el título ("Naruto, Vol. 7" → "Naruto") y deduplicamos.
 * El resultado es best-effort: cada título después se VERIFICA contra MU (que
 * confirme VIZ) en `importVizSeries`. Requiere GOOGLE_BOOKS_API_KEY.
 *
 * Devuelve null si falta la key (para que el caller avise claramente).
 */
export async function googleBooksVizTitles(
  maxPages = 15,
): Promise<string[] | null> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return null;

  const seen = new Map<string, string>(); // normalizado → título limpio
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${BASE}?q=${encodeURIComponent('inpublisher:"VIZ Media"')}` +
      `&maxResults=40&startIndex=${page * 40}&country=US&key=${key}`;
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) break;
    const json = await r.json().catch(() => null);
    const items: { volumeInfo?: { title?: string; publisher?: string } }[] =
      json?.items ?? [];
    if (items.length === 0) break;

    for (const it of items) {
      const vi = it.volumeInfo;
      if (!vi?.title) continue;
      // Solo si GB dice VIZ como editorial (inpublisher es laxo).
      if (vi.publisher && !/viz/i.test(vi.publisher)) continue;
      const title = seriesTitle(vi.title);
      if (!title || title.length < 2) continue;
      const norm = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!seen.has(norm)) seen.set(norm, title);
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  return [...seen.values()];
}

/** "Naruto, Vol. 7: The Path" / "Bleach, Vol. 1" / "X #3" → título de serie. */
function seriesTitle(raw: string): string {
  let t = raw.trim();
  // Corta en ", Vol. N" / ": Volume N" / ", Book N" / ", Tome N" y lo que sigue.
  t = t.replace(/[,:]?\s*(vol\.?|volume|book|tome|gn|tp)\s*\.?\s*\d+.*$/i, "");
  // Corta "#N" final.
  t = t.replace(/\s*#\s*\d+.*$/, "");
  // Corta sufijos sueltos de tomo ("Naruto 7" sólo si termina en número aislado
  // precedido de espacio y la base tiene letras — conservador, evita "Kaiju No. 8").
  return t.replace(/[\s,:;-]+$/, "").trim();
}
