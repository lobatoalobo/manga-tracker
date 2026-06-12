import { searchMangaList } from "./anilist";
import { getIvreaDataBySlug } from "./providers/ivrea";
import { authorMatches } from "./authorMatch";
import { searchableTitle, normalizeTitle } from "./catalog";

interface EditionRow {
  publisher: string;
  slug: string;
  title: string;
}

/** Autor que lista la editorial para una edición (cuando lo expone). */
async function publisherAuthor(row: EditionRow): Promise<string | null> {
  if (row.publisher === "Ivrea Argentina") {
    const ficha = await getIvreaDataBySlug(row.slug).catch(() => null);
    return ficha?.author ?? null;
  }
  // Panini no expone autor; Ovni requeriría una ficha de producto (TODO).
  return null;
}

/**
 * Resuelve, **verificado por autor**, la serie de AniList que corresponde a una
 * edición del catálogo de una editorial. Devuelve el anilistId o null.
 *
 * - Con autor de la editorial (Ivrea): elige el candidato cuyo autor coincide
 *   (evita homónimos de distinta autoría, p. ej. "Aku no Hana" de Oshimi vs. el
 *   de Kamimura).
 * - Sin autor (Panini/Ovni): exige coincidencia EXACTA de título normalizado.
 *
 * Conservador: si no hay match confiable, devuelve null (no inventa el mapeo).
 */
export async function resolveEditionSeries(
  row: EditionRow,
): Promise<number | null> {
  const cleaned = searchableTitle(row.title);
  if (!cleaned) return null;

  const candidates: any[] = await searchMangaList(cleaned, true).catch(() => []);
  if (candidates.length === 0) return null;

  const author = await publisherAuthor(row);
  if (author) {
    const match = candidates.find((c) => {
      const ca = c.staff?.nodes?.[0]?.name?.full;
      return ca && authorMatches([ca], author);
    });
    return match?.id ?? null;
  }

  const nc = normalizeTitle(cleaned);
  const exact = candidates.find(
    (c) =>
      normalizeTitle(c.title?.romaji ?? "") === nc ||
      normalizeTitle(c.title?.english ?? "") === nc,
  );
  return exact?.id ?? null;
}
