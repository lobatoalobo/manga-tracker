/**
 * Total de tomos de una serie según la mejor fuente disponible.
 *
 * Prioridad (de mayor a menor):
 *   1. customTotalVolumes  → override manual del usuario.
 *   2. muVolumes           → MangaUpdates (edición estándar), fuente autoritativa.
 *   3. argentinaVolumes    → tomos publicados localmente (Ivrea AR).
 *   4. apiTotalVolumes     → total de AniList (null en series en curso).
 *   5. japanVolumes        → tomos publicados en Japón (referencia).
 */
export function getTotalVolumes(manga: {
  customTotalVolumes?: number | null;
  muVolumes?: number | null;
  argentinaVolumes?: number | null;
  apiTotalVolumes?: number | null;
  japanVolumes?: number | null;
}): number {
  return (
    manga.customTotalVolumes ||
    manga.muVolumes ||
    manga.argentinaVolumes ||
    manga.apiTotalVolumes ||
    manga.japanVolumes ||
    0
  );
}
