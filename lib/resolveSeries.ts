import { searchMangaList, searchStaffManga } from "./anilist";
import { getIvreaDataBySlug } from "./providers/ivrea";
import { authorMatches } from "./authorMatch";
import { searchableTitle, normalizeTitle } from "./catalog";

interface EditionRow {
  publisher: string;
  slug: string;
  title: string;
}

/** Candidato cuyo título normalizado coincide EXACTO con el término. */
function byExactTitle(candidates: any[], term: string): number | null {
  const nc = normalizeTitle(term);
  const m = candidates.find(
    (c) =>
      normalizeTitle(c.title?.romaji ?? "") === nc ||
      normalizeTitle(c.title?.english ?? "") === nc,
  );
  return m?.id ?? null;
}

/** Primer candidato cuyo autor coincide con `author`. */
function byAuthor(candidates: any[], author: string): number | null {
  const m = candidates.find((c) => {
    const a = c.staff?.nodes?.[0]?.name?.full;
    return a && authorMatches([a], author);
  });
  return m?.id ?? null;
}

/**
 * Resuelve un anilistId a partir de título + autor (p. ej. lo que da Whakoom).
 * Orden: título exacto (alta confianza) → autor entre los candidatos → búsqueda
 * por autor (Staff) para títulos solo en español.
 */
export async function resolveByTitleAuthor(
  title: string,
  author: string | null,
): Promise<number | null> {
  const cleaned = searchableTitle(title);
  if (!cleaned) return null;

  const candidates: any[] = await searchMangaList(cleaned, true).catch(() => []);

  // 1) Título exacto (evita agarrar el spin-off / la principal por error).
  const exact = byExactTitle(candidates, cleaned);
  if (exact) return exact;

  // 2) Autor entre los candidatos de la búsqueda por título.
  if (author) {
    const m = byAuthor(candidates, author);
    if (m) return m;
  }

  // 3) Título solo en español (no matchea): buscamos por AUTOR (Staff) y
  //    elegimos su obra con más coincidencia de palabras, o la única.
  if (author) {
    const works = await searchStaffManga(author).catch(() => []);
    if (works.length === 0) return null;

    const titleTokens = new Set(
      normalizeTitle(cleaned)
        .split(" ")
        .filter((w) => w.length >= 3),
    );
    let best: { id: number } | null = null;
    let bestScore = 0;
    for (const w of works) {
      const wt = `${normalizeTitle(w.title?.romaji ?? "")} ${normalizeTitle(
        w.title?.english ?? "",
      )}`
        .split(" ")
        .filter(Boolean);
      const score = wt.filter((t) => titleTokens.has(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (best && bestScore > 0) return best.id;
    if (works.length === 1) return works[0].id;
  }

  return null;
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
 * Resuelve la serie de AniList para una edición del catálogo de una editorial.
 *
 * Orden: **título exacto primero** (alta confianza; evita que un spin-off como
 * "One Piece: Episode A" se mapee a la principal por compartir autor), y recién
 * después match por autor. Prueba varios términos (título del crawl, título de
 * la ficha, slug) porque el del crawl a veces viene sucio ("1-F (Fukushima 1)").
 *
 * Conservador: si no hay match confiable, devuelve null.
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

  // 1) Título exacto, probando todos los términos.
  const searches: { term: string; cands: any[] }[] = [];
  for (const term of terms) {
    const cands = await searchMangaList(term, true).catch(() => []);
    searches.push({ term, cands });
    const exact = byExactTitle(cands, term);
    if (exact) return exact;
  }

  // 2) Autor (fallback) sobre los candidatos ya buscados.
  if (info.author) {
    for (const { cands } of searches) {
      const m = byAuthor(cands, info.author);
      if (m) return m;
    }
  }

  return null;
}
