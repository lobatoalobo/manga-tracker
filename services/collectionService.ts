import type { CollectionItem } from "@/lib/collection";

export type CollectionStatus = "al-dia" | "incompleta" | "unknown";

export interface EditionProgress {
  owned: number;
  total: number;
  read: number;
  ownedPct: number; // tenés / total (completitud)
  readPct: number; // leídos / total (avance de lectura sobre la serie)
  status: CollectionStatus;
}

/** Completitud y avance de lectura de una edición (para badges y barras). */
export function editionProgress(e: {
  totalVolumes: number;
  readingStatus: string;
  readingVolume: number | null;
  ownedVolumes: number[];
}): EditionProgress {
  const owned = e.ownedVolumes.length;
  const total = e.totalVolumes;
  const rawRead =
    e.readingVolume != null
      ? e.readingVolume
      : e.readingStatus === "READ"
        ? total || owned
        : 0;
  // La lectura se topa en el TOTAL de la serie (podés leer online tomos que no
  // tenés, pero no más que los que existen). NO se topa en lo que tenés (owned).
  const read = Math.min(Math.max(0, rawRead), total || rawRead);
  return {
    owned,
    total,
    read,
    ownedPct: total > 0 ? Math.min(100, Math.floor((owned / total) * 100)) : 0,
    readPct: total > 0 ? Math.min(100, Math.floor((read / total) * 100)) : 0,
    status: total > 0 ? (owned >= total ? "al-dia" : "incompleta") : "unknown",
  };
}

/**
 * Porcentaje de progreso PÚBLICO (Share, ADR-011 / Slice 9 / Checkpoint 7). Comparte el numerador con el stat
 * "Tomos poseídos": `ownedVolumes` viene del read-side unificado; `totalVolumes` sigue del camino legado rico. NO
 * hay re-join por volumen ni migración de metadata: es un agregado derivado del mismo numerador que ya muestra la
 * página. `totalVolumes <= 0` → 0 (sin división por cero). Clamp a 100 = protección de PRESENTACIÓN: una divergencia
 * legítima por ambigüedad puede dar `ownedVolumes > totalVolumes`; el clamp NO altera el conteo real (`ownedVolumes`
 * se conserva crudo) ni el dominio ni deduplica unidades. Es independiente de `getCollectionStats.percentage`
 * (legado, que sirve a `app/collection`): este helper es exclusivo de la Share migrada.
 */
export function progressPercentage(ownedVolumes: number, totalVolumes: number): number {
  if (totalVolumes <= 0) return 0;
  return Math.min(Math.round((ownedVolumes / totalVolumes) * 100), 100);
}

export function getCollectionStats(items: CollectionItem[]) {
  const series = new Set(items.map((i) => i.anilistId)).size;
  const editions = items.length;

  const ownedVolumes = items.reduce(
    (sum, i) => sum + i.edition.ownedVolumes.length,
    0,
  );
  const totalVolumes = items.reduce(
    (sum, i) => sum + i.edition.totalVolumes,
    0,
  );
  const readVolumes = items.reduce(
    (sum, i) => sum + editionProgress(i.edition).read,
    0,
  );

  const percentage =
    totalVolumes > 0 ? Math.floor((ownedVolumes / totalVolumes) * 100) : 0;
  const readPercentage =
    totalVolumes > 0 ? Math.floor((readVolumes / totalVolumes) * 100) : 0;

  return {
    series,
    editions,
    ownedVolumes,
    totalVolumes,
    readVolumes,
    percentage,
    readPercentage,
  };
}
