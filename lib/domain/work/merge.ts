/**
 * Dominio: fusión de Works. PURO — sin Prisma, sin framework, sin I/O. Define las
 * reglas (qué es "la misma serie", qué cambia una fusión) y los PUERTOS de datos
 * que la orquestación necesita. La implementación de los puertos vive en infra
 * (lib/infra/work/merge.ts); la orquestación en lib/catalog/mutations/mergeWork.ts.
 *
 * Las claves de identidad (`tightTitleKey`/`romajiKey`) viven en lib/catalog y son
 * puras; se reusan acá sin arrastrar dependencias de datos.
 */
import { romajiKey, tightTitleKey } from "@/lib/catalog";
import { workDomainKey } from "@/lib/domain/work/identity";

/** Identidad mínima para decidir si dos Works son la MISMA serie. */
export interface SeriesIdentity {
  title: string;
  anilistId: number | null;
  muId: string | null;
  mdId: string | null;
  originalTitle: string | null;
}

/** Campos del Work que la fusión lee para decidir backfill/identidad. */
export interface MergeWorkRow extends SeriesIdentity {
  id: number;
  coverImage: string | null;
  author: string | null;
  synopsis: string | null;
  upcoming: boolean;
  titleEn: string | null;
  titleNative: string | null;
  assistants: string | null;
  synopsisEs: string | null;
  synopsisEn: string | null;
  synopsisEsAuto: boolean;
  synopsisEnAuto: boolean;
  demographic: string | null;
  genres: string[];
  rawGenres: string[];
}

export interface MergePlan {
  sourceId: number;
  targetId: number;
  finalKey: number;
  srcOldKey: number;
  tgtOldKey: number;
  /** Campos @unique a liberar en el source ANTES de pasarlos al target. */
  free: Record<string, null>;
  /** Backfill de campos vacíos del target desde el source. */
  patch: Record<string, unknown>;
}

/**
 * Invariante del merge — la causa raíz de los over-merge fue NO tener esto: el
 * matcher pegaba el muId de una serie base a un spin-off y se fusionaban series
 * distintas. Conservador: ante la duda, NO es la misma serie.
 */
export function sameSeries(a: SeriesIdentity, b: SeriesIdentity): boolean {
  // Rechazo fuerte: dos identidades externas confirmadas y DISTINTAS = no es dup.
  if (a.anilistId && b.anilistId && a.anilistId !== b.anilistId) return false;
  if (a.muId && b.muId && a.muId !== b.muId) return false;
  if (a.mdId && b.mdId && a.mdId !== b.mdId) return false;
  // Señal positiva: misma identidad externa…
  if (a.anilistId && a.anilistId === b.anilistId) return true;
  if (a.muId && a.muId === b.muId) return true;
  if (a.mdId && a.mdId === b.mdId) return true;
  // …o mismo título estricto / mismo romaji base (conserva "+": Citrus ≠ Citrus+).
  if (tightTitleKey(a.title) === tightTitleKey(b.title)) return true;
  if (a.originalTitle && b.originalTitle && romajiKey(a.originalTitle) === romajiKey(b.originalTitle))
    return true;
  return false;
}

/**
 * Reglas de seguridad de la fusión (puras). Devuelve el motivo del rechazo o
 * `null` si es segura. La orquestación lo mapea a un error del framework.
 */
export function mergeSafetyViolation(
  sourceId: number,
  targetId: number,
  src: SeriesIdentity,
  tgt: SeriesIdentity,
): string | null {
  if (sourceId === targetId) return "source y target son el mismo Work";
  if (!sameSeries(src, tgt))
    return `works ${sourceId}/${targetId} no parecen la misma serie`;
  return null;
}

/**
 * Decide QUÉ cambia la fusión (PLAN puro). Lo arma `preview` y lo aplica `execute`
 * — una sola lógica, cero drift.
 */
export function buildMergePlan(
  sourceId: number,
  targetId: number,
  src: MergeWorkRow,
  tgt: MergeWorkRow,
): MergePlan {
  // Clave de dominio de cada Work: positiva = anilistId (la colección/deseados se
  // clavan por el anilistId de la serie), negativa = -id para obras locales. El
  // target PUEDE adquirir el anilistId del source en el backfill; su clave final
  // es esa. Consolidamos la data de usuario de ambas claves viejas bajo la final.
  const finalKey = tgt.anilistId ?? src.anilistId ?? -targetId;
  const srcOldKey = workDomainKey({ anilistId: src.anilistId, id: sourceId });
  const tgtOldKey = workDomainKey({ anilistId: tgt.anilistId, id: targetId });

  const free: Record<string, null> = {};
  if (src.anilistId) free.anilistId = null;
  if (src.muId) free.muId = null;
  if (src.mdId) free.mdId = null;

  const patch: Record<string, unknown> = {};
  if (!tgt.anilistId && src.anilistId) patch.anilistId = src.anilistId;
  if (!tgt.coverImage && src.coverImage) patch.coverImage = src.coverImage;
  if (!tgt.author && src.author) patch.author = src.author;
  if (!tgt.synopsis && src.synopsis) patch.synopsis = src.synopsis;
  if (!tgt.originalTitle && src.originalTitle) patch.originalTitle = src.originalTitle;
  if (!tgt.upcoming && src.upcoming) patch.upcoming = true;
  if (!tgt.muId && src.muId) patch.muId = src.muId;
  if (!tgt.mdId && src.mdId) patch.mdId = src.mdId;
  if (!tgt.titleEn && src.titleEn) patch.titleEn = src.titleEn;
  if (!tgt.titleNative && src.titleNative) patch.titleNative = src.titleNative;
  if (!tgt.assistants?.length && src.assistants?.length) patch.assistants = src.assistants;
  if (!tgt.synopsisEs && src.synopsisEs) {
    patch.synopsisEs = src.synopsisEs;
    patch.synopsisEsAuto = src.synopsisEsAuto;
  }
  if (!tgt.synopsisEn && src.synopsisEn) {
    patch.synopsisEn = src.synopsisEn;
    patch.synopsisEnAuto = src.synopsisEnAuto;
  }
  if (!tgt.demographic && src.demographic) patch.demographic = src.demographic;
  if (!tgt.genres?.length && src.genres?.length) patch.genres = src.genres;
  if (!tgt.rawGenres?.length && src.rawGenres?.length) patch.rawGenres = src.rawGenres;

  return { sourceId, targetId, finalKey, srcOldKey, tgtOldKey, free, patch };
}

// --- Puertos de datos (interfaces; impl en infra) ---

/** Lecturas que la fusión necesita. */
export interface MergeReadPort {
  loadIdentity(id: number): Promise<SeriesIdentity | null>;
  loadRow(id: number): Promise<MergeWorkRow | null>;
  countEditions(workId: number): Promise<number>;
}

/** Escrituras que la fusión necesita (solo dentro de la transacción). */
export interface MergeWritePort {
  /** Lock pesimista de los Works (serializa merges sobre los mismos ids). */
  lockWorks(ids: number[]): Promise<void>;
  /** Aplica el plan; devuelve cuántas ediciones movió. */
  applyPlan(plan: MergePlan): Promise<number>;
}
