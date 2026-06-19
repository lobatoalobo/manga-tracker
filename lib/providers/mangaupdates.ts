const BASE = "https://api.mangaupdates.com/v1";
const DAY = 60 * 60 * 24;

export interface MUFormat {
  count: number;
  label: string; // "Volumes", "Kanzenban", "Bunkoban", "Combini-ban", etc.
  complete: boolean;
  isStandard: boolean; // true para la edición estándar ("Volumes")
}

export interface MangaUpdatesData {
  seriesId: number;
  title: string;
  year: number | null;
  completed: boolean;
  formats: MUFormat[];
  /** Tomos de la edición estándar (formato "Volumes"). */
  standardVolumes: number | null;
}

/**
 * Resuelve datos de MangaUpdates para una serie.
 *
 * MU es la fuente más confiable para el conteo de tomos por formato, pero hay
 * que matchear bien la serie: validamos el título contra los que nos pasan
 * (de AniList) y, si se da, contra un total esperado. Devolvemos null si el
 * mejor candidato no es lo bastante confiable.
 */
export async function getMangaUpdatesData(
  titles: string | string[],
  opts: { expectedVolumes?: number | null } = {},
): Promise<MangaUpdatesData | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  if (titleList.length === 0) return null;

  const candidates = await search(titleList[0]);
  if (candidates.length === 0) return null;

  const targets = titleList.map(normalize);

  // Candidatos cuyo título matchea de verdad (no solapamientos espurios).
  const matched = candidates
    .map((c) => ({ c, score: titleScore(c.title, c.associated, targets) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (matched.length === 0) return null;

  // MU suele tener varias fichas por serie (edición específica vs principal).
  // Traemos el detalle de los mejores y elegimos el más confiable: que tenga
  // edición estándar ("Volumes") y, si AniList dio un total, que esté cerca.
  const details = (
    await Promise.all(matched.map((m) => getSeries(m.c.seriesId)))
  ).filter((d): d is MangaUpdatesData => d !== null);

  if (details.length === 0) return null;

  const expected = opts.expectedVolumes ?? null;

  const scored = details
    .map((d) => ({ d, score: confidence(d, expected) }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];

  // Si esperábamos un total y el ganador difiere mucho de su edición estándar,
  // probablemente matcheamos mal: mejor no devolver nada que mentir.
  if (
    expected &&
    winner.d.standardVolumes &&
    Math.abs(winner.d.standardVolumes - expected) > 3
  ) {
    return null;
  }

  return winner.d;
}

/** Confianza de una ficha: prioriza tener edición estándar y cercanía al total esperado. */
function confidence(d: MangaUpdatesData, expected: number | null): number {
  let score = 0;
  if (d.standardVolumes) score += 1000;
  if (expected && d.standardVolumes) score -= Math.abs(d.standardVolumes - expected) * 10;
  else if (d.standardVolumes) score += d.standardVolumes;
  if (d.completed) score += 5;
  return score;
}

export interface MangaUpdatesEnrich {
  seriesId: number;
  title: string;
  year: number | null;
  genres: string[];
  description: string | null;
  coverImage: string | null;
}

/**
 * Datos de enriquecimiento de MangaUpdates (géneros, sinopsis, portada del
 * original). Matchea por título contra `targets` (romaji primero); valida año
 * (±1) si se conoce. Devuelve null si no hay match confiable.
 */
export async function getMangaUpdatesEnrich(
  targets: string[],
  opts: { year?: number | null } = {},
): Promise<MangaUpdatesEnrich | null> {
  const q = targets.find(Boolean);
  if (!q) return null;
  const candidates = await search(q);
  if (!candidates.length) return null;
  const wanted = targets.map(normalize).filter(Boolean);

  const matched = candidates
    .map((c) => ({ c, score: titleScore(c.title, c.associated, wanted) }))
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!matched.length) return null;

  const year = opts.year ?? null;
  for (const { c } of matched) {
    const d = await getSeriesFull(c.seriesId);
    if (!d) continue;
    if (year && d.year && Math.abs(d.year - year) > 1) continue; // año no cuadra
    return d;
  }
  return null;
}

export interface MuLicensed {
  seriesId: number;
  title: string; // título principal (romaji/oficial) de MU
  author: string | null;
  year: number | null;
  genres: string[];
  description: string | null;
  coverImage: string | null;
  standardVolumes: number | null;
  /** Nombres de editoriales con type "English" (p. ej. "VIZ Media"). */
  englishPublishers: string[];
}

/**
 * Detalle rico de MU para una serie (por título): editoriales (qué licencia en
 * inglés), conteo estándar, autor, géneros, año, sinopsis, portada. Para armar
 * ediciones internacionales (VIZ). Devuelve null si no hay match confiable.
 */
export async function getMuLicensed(
  titles: string[],
): Promise<MuLicensed | null> {
  const targets = titles.map(normalize).filter(Boolean);
  const q = titles.find(Boolean);
  if (!q) return null;
  const candidates = await search(q);
  const matched = candidates
    .map((c) => ({ c, score: titleScore(c.title, c.associated, targets) }))
    .filter((x) => x.score >= 80) // exacto o casi (evita falsos)
    .sort((a, b) => b.score - a.score);
  if (!matched.length) return null;

  const id = matched[0].c.seriesId;
  const r = await fetch(`${BASE}/series/${id}`, { next: { revalidate: DAY } });
  if (!r.ok) return null;
  const d = await r.json();
  const formats = parseStatus(String(d.status || ""));
  const standard = formats.find((f) => f.isStandard);
  const englishPublishers: string[] = (d.publishers || [])
    .filter((p: { type?: string }) => p.type === "English")
    .map((p: { publisher_name?: string }) => stripHtml(p.publisher_name || ""))
    .filter(Boolean);
  const author =
    (d.authors || [])
      .filter((a: { type?: string }) => /author|story/i.test(a.type || ""))
      .map((a: { name?: string }) => stripHtml(a.name || ""))[0] ??
    (d.authors?.[0]?.name ? stripHtml(d.authors[0].name) : null);

  return {
    seriesId: id,
    title: stripHtml(d.title || matched[0].c.title || ""),
    author,
    year: d.year ? Number(d.year) : null,
    genres: (d.genres || []).map((g: { genre?: string }) => g.genre).filter(Boolean),
    description: d.description ? stripHtml(d.description) : null,
    coverImage: d.image?.url?.original ?? null,
    standardVolumes: standard?.count ?? null,
    englishPublishers,
  };
}

async function getSeriesFull(id: number): Promise<MangaUpdatesEnrich | null> {
  const r = await fetch(`${BASE}/series/${id}`, { next: { revalidate: DAY } });
  if (!r.ok) return null;
  const d = await r.json();
  return {
    seriesId: id,
    title: stripHtml(d.title || ""),
    year: d.year ? Number(d.year) : null,
    genres: (d.genres || []).map((g: any) => g.genre).filter(Boolean),
    description: d.description ? stripHtml(d.description) : null,
    coverImage: d.image?.url?.original ?? null,
  };
}

// --- internals -------------------------------------------------------------

interface Candidate {
  seriesId: number;
  title: string;
  associated: string[];
}

async function search(title: string): Promise<Candidate[]> {
  const r = await fetch(`${BASE}/series/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search: title, perpage: 8 }),
    next: { revalidate: DAY },
  });
  if (!r.ok) return [];

  const json = await r.json();
  return (json.results || []).map((res: any) => ({
    seriesId: res.record.series_id,
    title: stripHtml(res.record.title || ""),
    associated: (res.record.associated || []).map((a: any) =>
      stripHtml(a.title || ""),
    ),
  }));
}

async function getSeries(id: number): Promise<MangaUpdatesData | null> {
  const r = await fetch(`${BASE}/series/${id}`, { next: { revalidate: DAY } });
  if (!r.ok) return null;

  const dj = await r.json();
  const formats = parseStatus(String(dj.status || ""));
  const standard = formats.find((f) => f.isStandard);

  return {
    seriesId: id,
    title: stripHtml(dj.title || ""),
    year: dj.year ? Number(dj.year) : null,
    completed: Boolean(dj.completed),
    formats,
    standardVolumes: standard?.count ?? null,
  };
}

/**
 * Parsea el campo `status` de MU, p. ej.:
 *   "72 Volumes (Complete)\n24 Combini-ban Volumes (Complete)"
 *   "22 Volumes (2000 - Complete)\n11 Kanzenban (2016 - Complete)"
 */
function parseStatus(status: string): MUFormat[] {
  return status
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+([A-Za-z\- ]+?)\s*\(/);
      if (!m) return null;

      const count = Number(m[1]);
      const label = m[2].trim();
      // La edición estándar se etiqueta simplemente "Volumes".
      const isStandard = /^volumes?$/i.test(label);

      return {
        count,
        label,
        complete: /complete/i.test(line),
        isStandard,
      };
    })
    .filter((x): x is MUFormat => x !== null);
}

function titleScore(
  title: string,
  associated: string[],
  targets: string[],
): number {
  const names = [title, ...associated].map(normalize);
  let best = 0;

  for (const t of targets) {
    for (const n of names) {
      if (n === t) return 100; // match exacto
      // Compacto (sin espacios): "high school dxd" ~ "highschool dxd",
      // "gachi akuta" ~ "gachiakuta".
      if (n.replace(/ /g, "") === t.replace(/ /g, "")) return 95;

      // Similitud Jaccard (intersección / unión): simétrica y estricta.
      // Evita que un título corto matchee uno más largo que lo contiene
      // (p. ej. "real" ~ "real clothes" daría 0.5 y se descarta).
      const overlap = tokenOverlap(n, t);
      if (overlap >= 0.6) best = Math.max(best, 40 + overlap * 50);
    }
  }

  return best;
}

function tokenOverlap(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter); // Jaccard
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
