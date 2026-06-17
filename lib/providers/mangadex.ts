const BASE = "https://api.mangadex.org";
const DAY = 60 * 60 * 24;

export interface MangaDexData {
  id: string;
  title: string;
  year: number | null;
  genres: string[]; // tags de grupo genre/theme
  coverImage: string | null; // portada del original (thumb 512)
  description: string | null; // inglés
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Busca una serie en MangaDex y devuelve datos de enriquecimiento (tags +
 * portada del original). Matchea por título contra `targets` (romaji primero) y,
 * si hay año esperado, lo usa para desambiguar. Excluye contenido pornográfico.
 * Devuelve null si no hay match confiable.
 */
export async function getMangaDex(
  targets: string[],
  opts: { year?: number | null } = {},
): Promise<MangaDexData | null> {
  const q = targets.find(Boolean);
  if (!q) return null;
  const url =
    `${BASE}/manga?title=${encodeURIComponent(q)}&limit=5` +
    `&includes[]=cover_art&order[relevance]=desc` +
    `&contentRating[]=safe&contentRating[]=suggestive`;
  const r = await fetch(url, { next: { revalidate: DAY } }).catch(() => null);
  if (!r || !r.ok) return null;
  const json = await r.json().catch(() => null);
  const list: any[] = json?.data ?? [];
  if (!list.length) return null;

  const wanted = new Set(targets.map(norm).filter(Boolean));
  const wantedCompact = new Set([...wanted].map((w) => w.replace(/ /g, "")));
  const year = opts.year ?? null;

  const scored = list
    .map((m) => {
      const a = m.attributes ?? {};
      const names: string[] = [
        ...Object.values(a.title ?? {}),
        ...(a.altTitles ?? []).flatMap((t: any) => Object.values(t)),
      ].map((x) => norm(String(x)));
      const exact = names.some(
        (n) => wanted.has(n) || wantedCompact.has(n.replace(/ /g, "")),
      );
      const yearOk = !year || !a.year || Math.abs(Number(a.year) - year) <= 1;
      return { m, a, exact, yearOk };
    })
    .filter((x) => x.exact && x.yearOk);

  const pick = scored[0];
  if (!pick) return null;

  const { m, a } = pick;
  const cover = m.relationships?.find((x: any) => x.type === "cover_art")
    ?.attributes?.fileName as string | undefined;
  const genres = (a.tags ?? [])
    .filter((t: any) => ["genre", "theme"].includes(t.attributes?.group))
    .map((t: any) => t.attributes?.name?.en)
    .filter(Boolean);

  return {
    id: m.id,
    title: a.title?.en ?? String(Object.values(a.title ?? {})[0] ?? ""),
    year: a.year ? Number(a.year) : null,
    genres,
    coverImage: cover
      ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.512.jpg`
      : null,
    description: a.description?.en ?? null,
  };
}
