/**
 * Adapter READ-ONLY del universo de catálogo para el scan de backfilleabilidad (F2 PR-1). Dado el conjunto de anclas
 * de un usuario (`anilistId` positivos y `workId` de obras locales), devuelve los `Volume` candidatos y las
 * `PublisherEdition` candidatas.
 *
 * A diferencia del `collectionOwnershipSource` de F1 (que lee `OwnershipPosition`), acá el universo son los `Volume`
 * que EXISTEN en el catálogo para esas anclas —no los que el usuario ya posee—: el backfill pregunta si hay un
 * `Volume` al cual apuntar, no cuáles ya tiene. Una sola query (`PublisherEdition` con `Volume` anidados) provee
 * ambas cosas: los volúmenes (correspondencia) y la existencia de edición/key por ancla (refinar huérfanos).
 * SÓLO LECTURA: un único `findMany`, sin escrituras.
 */
import type { PrismaClient } from "@prisma/client";
import type { CatalogVolumeRef } from "@/lib/collection-read/mapping/correspondence";
import type { CatalogEditionRef } from "@/lib/collection-read/backfill-scan";

export type CatalogUniverse = { volumes: CatalogVolumeRef[]; editions: CatalogEditionRef[] };

export function catalogUniverseSource(client: PrismaClient) {
  return {
    /** `anilistIds` = anclas positivas; `workIds` = ids de obra local (positivos, ya convertidos desde `-workId`). */
    async forAnchors(anilistIds: readonly number[], workIds: readonly number[]): Promise<CatalogUniverse> {
      if (anilistIds.length === 0 && workIds.length === 0) return { volumes: [], editions: [] };
      const eds = await client.publisherEdition.findMany({
        where: {
          OR: [
            ...(anilistIds.length ? [{ anilistId: { in: [...anilistIds] } }] : []),
            ...(workIds.length ? [{ workId: { in: [...workIds] } }] : []),
          ],
        },
        select: {
          anilistId: true,
          workId: true,
          publisher: true,
          // `volumesList` es la relación a Volume[]; `volumes` (Int) es sólo el conteo cacheado.
          volumesList: { select: { id: true, number: true } },
        },
      });

      const volumes: CatalogVolumeRef[] = [];
      const editions: CatalogEditionRef[] = [];
      for (const e of eds) {
        editions.push({ anilistId: e.anilistId, workId: e.workId, publisher: e.publisher });
        for (const v of e.volumesList) {
          volumes.push({
            volumeId: v.id,
            number: v.number,
            anilistId: e.anilistId,
            workId: e.workId,
            publisher: e.publisher,
          });
        }
      }
      return { volumes, editions };
    },
  };
}
