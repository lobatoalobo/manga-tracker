import type { CollectionItem } from "@/lib/collection";

export type CollectionStatus = "al-dia" | "incompleta" | "unknown";

export interface EditionProgress {
  owned: number;
  total: number;
  read: number;
  ownedPct: number; // tenés / total (completitud)
  readPct: number; // leídos / tenés (avance de lectura)
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
  const read = Math.min(Math.max(0, rawRead), owned);
  return {
    owned,
    total,
    read,
    ownedPct: total > 0 ? Math.min(100, Math.floor((owned / total) * 100)) : 0,
    readPct: owned > 0 ? Math.min(100, Math.floor((read / owned) * 100)) : 0,
    status: total > 0 ? (owned >= total ? "al-dia" : "incompleta") : "unknown",
  };
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
    ownedVolumes > 0 ? Math.floor((readVolumes / ownedVolumes) * 100) : 0;

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
