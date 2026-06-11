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
