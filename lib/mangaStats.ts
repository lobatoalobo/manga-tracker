export function getMangaStats(manga: any) {
  const owned = manga.ownedVolumes.length;

  const total = manga.totalVolumes || 0;

  const percentage =
    total > 0
      ? Math.floor((owned / total) * 100)
      : 0;

  const missing = [];

  for (let i = 1; i <= total; i++) {
    if (
      !manga.ownedVolumes.includes(i)
    ) {
      missing.push(i);
    }
  }

  return {
    owned,
    total,
    percentage,
    missing,
  };
}