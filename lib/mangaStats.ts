import { getTotalVolumes } from "./getTotalVolumes";

export function getMangaStats(manga: any) {
  const owned = manga.ownedVolumes.length;

  const total = getTotalVolumes(manga);

  const percentage = total > 0 ? Math.floor((owned / total) * 100) : 0;

  // Si no conocemos el total,
  // no podemos calcular faltantes.
  if (total === 0) {
    return {
      owned,
      total,
      percentage,
      missing: null,
    };
  }

  const missing = [];

  for (let i = 1; i <= total; i++) {
    if (!manga.ownedVolumes.includes(i)) {
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
