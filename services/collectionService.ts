import type { CollectionItem } from "@/lib/collection";

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

  const percentage =
    totalVolumes > 0 ? Math.floor((ownedVolumes / totalVolumes) * 100) : 0;

  return { series, editions, ownedVolumes, totalVolumes, percentage };
}
