import { getTotalVolumes } from "@/lib/getTotalVolumes";

export function getCollectionStats(collection: any[]) {
  const mangas = collection.length;

  const ownedVolumes = collection.reduce(
    (sum, manga) => sum + manga.ownedVolumes.length,
    0,
  );

const totalVolumes = collection.reduce(
  (sum, manga) =>
    sum + getTotalVolumes(manga),
  0
);

  const percentage =
    totalVolumes > 0 ? Math.floor((ownedVolumes / totalVolumes) * 100) : 0;

  return {
    mangas,
    ownedVolumes,
    totalVolumes,
    percentage,
  };
}
