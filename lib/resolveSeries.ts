import { searchMangaList, searchStaffManga } from "./anilist";
import { getIvreaDataBySlug } from "./providers/ivrea";
import { authorMatches } from "./authorMatch";
import { searchableTitle, normalizeTitle } from "./catalog";
import { prisma } from "./prisma";

interface EditionRow {
  publisher: string;
  slug: string;
  title: string;
}

function titleMatches(c: any, nc: string): boolean {
  return (
    normalizeTitle(c.title?.romaji ?? "") === nc ||
    normalizeTitle(c.title?.english ?? "") === nc
  );
}

const staffNames = (c: any): string[] =>
  (c.staff?.nodes ?? []).map((n: any) => n?.name?.full).filter(Boolean);

/** Candidato cuyo título normalizado coincide EXACTO con el término. */
function byExactTitle(candidates: any[], term: string): number | null {
  const nc = normalizeTitle(term);
  const m = candidates.find((c) => titleMatches(c, nc));
  return m?.id ?? null;
}

/**
 * Candidato con título exacto Y autor que coincide. Alta confianza: evita mapear
 * a un homónimo (ej. "Adabana" de NON vs el hentai homónimo de otro autor).
 */
function byExactTitleAndAuthor(
  candidates: any[],
  term: string,
  author: string,
): number | null {
  const nc = normalizeTitle(term);
  const m = candidates.find(
    (c) => titleMatches(c, nc) && authorMatches(staffNames(c), author),
  );
  return m?.id ?? null;
}

/** Primer candidato cuyo autor coincide con `author`. */
function byAuthor(candidates: any[], author: string): number | null {
  const m = candidates.find((c) => authorMatches(staffNames(c), author));
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

  // 1) Título exacto + autor (gana sobre homónimos: "Adabana" de NON vs hentai).
  if (author) {
    const m = byExactTitleAndAuthor(candidates, cleaned, author);
    if (m) return m;
  }

  // 2) Título exacto a secas (best-effort; el staff de AniList suele venir con
  //    traductores primero, así que no exigimos autor para no descartar válidos).
  const exact = byExactTitle(candidates, cleaned);
  if (exact) return exact;

  // 3) Autor entre los candidatos de la búsqueda por título.
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

/** Autor, título y título original que lista la editorial (cuando los expone). */
async function publisherInfo(row: EditionRow): Promise<{
  author: string | null;
  title: string | null;
  originalTitle: string | null;
}> {
  if (row.publisher === "Ivrea Argentina") {
    const ficha = await getIvreaDataBySlug(row.slug).catch(() => null);
    return {
      author: ficha?.author ?? null,
      title: ficha?.title ?? null,
      originalTitle: ficha?.originalTitle ?? null,
    };
  }
  // Las demás editoriales no exponen ficha propia (Utopía ni siquiera tiene
  // sitio usable), pero el import de Whakoom guardó el autor en el Work: lo
  // usamos como señal de autor. Sin esto el botón "Auto" solo matcheaba por
  // título exacto y nunca resolvía los títulos en español.
  const ed = await prisma.publisherEdition
    .findUnique({
      where: { publisher_slug: { publisher: row.publisher, slug: row.slug } },
      select: { work: { select: { author: true } } },
    })
    .catch(() => null);
  return { author: ed?.work?.author ?? null, title: null, originalTitle: null };
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
        // El "NOMBRE ORIGINAL" (romaji) es el que mejor matchea en AniList.
        info.originalTitle ? searchableTitle(info.originalTitle) : "",
        searchableTitle(row.title),
        info.title ? searchableTitle(info.title) : "",
        row.slug.replace(/-/g, " ").trim(),
      ].filter(Boolean),
    ),
  ];

  const searches: { term: string; cands: any[] }[] = [];
  for (const term of terms) {
    const cands = await searchMangaList(term, true).catch(() => []);
    searches.push({ term, cands });
  }

  // 1) Título exacto + autor (máxima confianza): GANA sobre los homónimos. Acá
  //    es donde se desambigua "Adabana" de NON vs el hentai homónimo.
  if (info.author) {
    for (const { term, cands } of searches) {
      const m = byExactTitleAndAuthor(cands, term, info.author);
      if (m) return m;
    }
  }

  // 2) Título exacto a secas (best-effort). NO exigimos autor acá: el staff de
  //    AniList suele venir por relevancia con traductores primero, así que el
  //    autor real puede no aparecer (Hikaru/Uketsu) → exigirlo descartaría
  //    mapeos válidos. El paso 1 ya cubrió los homónimos verificables.
  for (const { term, cands } of searches) {
    const exact = byExactTitle(cands, term);
    if (exact) return exact;
  }

  // 3) Sin match por título: por AUTOR (títulos solo en español, Staff search).
  if (info.author) {
    for (const { cands } of searches) {
      const m = byAuthor(cands, info.author);
      if (m) return m;
    }
    const viaAuthor = await resolveByTitleAuthor(row.title, info.author).catch(
      () => null,
    );
    if (viaAuthor) return viaAuthor;
  }
  return null;
}
