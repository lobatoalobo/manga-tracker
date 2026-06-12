import { searchMangaList } from "./anilist";
import { getIvreaDataBySlug } from "./providers/ivrea";
import { authorMatches } from "./authorMatch";
import { searchableTitle, normalizeTitle } from "./catalog";

interface EditionRow {
  publisher: string;
  slug: string;
  title: string;
}

/**
 * Resuelve un anilistId a partir de título + autor (p. ej. lo que da Whakoom).
 * Con autor: elige el candidato cuyo autor coincide. Sin autor: título exacto.
 */
export async function resolveByTitleAuthor(
  title: string,
  author: string | null,
): Promise<number | null> {
  const cleaned = searchableTitle(title);
  if (!cleaned) return null;

  const candidates: any[] = await searchMangaList(cleaned, true).catch(() => []);
  if (candidates.length === 0) return null;

  if (author) {
    const match = candidates.find((c) => {
      const ca = c.staff?.nodes?.[0]?.name?.full;
      return ca && authorMatches([ca], author);
    });
    if (match) return match.id;
  }

  const nc = normalizeTitle(cleaned);
  const exact = candidates.find(
    (c) =>
      normalizeTitle(c.title?.romaji ?? "") === nc ||
      normalizeTitle(c.title?.english ?? "") === nc,
  );
  return exact?.id ?? null;
}

/** Autor + título que lista la editorial (cuando los expone). */
async function publisherInfo(
  row: EditionRow,
): Promise<{ author: string | null; title: string | null }> {
  if (row.publisher === "Ivrea Argentina") {
    const ficha = await getIvreaDataBySlug(row.slug).catch(() => null);
    return { author: ficha?.author ?? null, title: ficha?.title ?? null };
  }
  // Panini no expone autor; Ovni requeriría una ficha de producto (TODO).
  return { author: null, title: null };
}

/**
 * Resuelve, **verificado por autor**, la serie de AniList para una edición del
 * catálogo de una editorial. Devuelve el anilistId o null.
 *
 * - Prueba varios términos de búsqueda (título del crawl, título de la ficha y
 *   el slug), porque el título del crawl a veces viene sucio ("1-F (Fukushima 1)").
 * - Con autor de la editorial (Ivrea): elige el candidato cuyo autor coincide
 *   (evita homónimos, p. ej. "Aku no Hana" de Oshimi vs. el de Kamimura).
 * - Sin autor (Panini/Ovni): exige título EXACTO normalizado.
 *
 * Conservador: si no hay match confiable, devuelve null (no inventa el mapeo).
 */
export async function resolveEditionSeries(
  row: EditionRow,
): Promise<number | null> {
  const info = await publisherInfo(row);

  const terms = [
    ...new Set(
      [
        searchableTitle(row.title),
        info.title ? searchableTitle(info.title) : "",
        row.slug.replace(/-/g, " ").trim(),
      ].filter(Boolean),
    ),
  ];

  for (const term of terms) {
    const candidates: any[] = await searchMangaList(term, true).catch(() => []);
    if (candidates.length === 0) continue;

    if (info.author) {
      const match = candidates.find((c) => {
        const ca = c.staff?.nodes?.[0]?.name?.full;
        return ca && authorMatches([ca], info.author!);
      });
      if (match) return match.id;
    } else {
      const nc = normalizeTitle(term);
      const match = candidates.find(
        (c) =>
          normalizeTitle(c.title?.romaji ?? "") === nc ||
          normalizeTitle(c.title?.english ?? "") === nc,
      );
      if (match) return match.id;
    }
  }
  return null;
}
