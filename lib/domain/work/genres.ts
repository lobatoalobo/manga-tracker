/**
 * Dominio: normalización de géneros (familia 4 — enrich/backfill). PURO. Es una
 * mutación SEMÁNTICA (refina atributos), no estructural: no toca identidad ni
 * topología, no borra. El "plan" es una lista de PATCHES de campos. Idempotente por
 * overwrite (re-correr desde `rawGenres` da lo mismo). Respeta el invariante
 * transversal de campos curados (lib/domain/work/curated).
 */
import { normalizeGenres } from "@/lib/genres";
import { dropCuratedFields } from "@/lib/domain/work/curated";

export interface GenreRow {
  id: number;
  title: string;
  genres: string[];
  rawGenres: string[];
  demographic: string | null;
  curated: string[];
}

export interface GenrePatch {
  workId: number;
  title: string;
  data: { rawGenres?: string[]; genres?: string[]; demographic?: string | null };
}

export type GenreEnrichPlan = GenrePatch[];

/**
 * Arma los patches: por cada obra, normaliza desde `rawGenres` (o `genres` si no hay
 * crudo), incluye solo los campos que CAMBIAN, aplica el guard curado y descarta la
 * obra si no queda nada para escribir. Puro y testeable.
 */
export function planGenreNormalization(rows: GenreRow[]): GenreEnrichPlan {
  const plan: GenreEnrichPlan = [];
  for (const w of rows) {
    const source = w.rawGenres.length ? w.rawGenres : w.genres;
    if (source.length === 0) continue;
    const { genres, demographic } = normalizeGenres(source);

    const data: GenrePatch["data"] = {};
    if (w.rawGenres.length === 0) data.rawGenres = w.genres; // backup del crudo una vez
    const sameGenres =
      genres.length === w.genres.length && genres.every((g) => w.genres.includes(g));
    if (!sameGenres) data.genres = genres;
    if ((w.demographic ?? null) !== (demographic ?? null)) data.demographic = demographic ?? null;

    const guarded = dropCuratedFields(data, w.curated);
    if (Object.keys(guarded).length === 0) continue;
    plan.push({ workId: w.id, title: w.title, data: guarded });
  }
  return plan;
}

// --- Puertos de datos (interfaces; impl en infra) ---

export interface GenreEnrichReadPort {
  loadCandidates(): Promise<GenreRow[]>;
}

export interface GenreEnrichWritePort {
  /** Aplica los patches (update por obra); devuelve cuántas tocó. */
  applyPatches(plan: GenreEnrichPlan): Promise<number>;
}
