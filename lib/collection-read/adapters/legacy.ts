/**
 * Adapter legado del read-side unificado (ADR-011, Slice 9 / Checkpoint 4): implementa
 * `OwnershipSource<LegacyObservation>` sobre el modelo legado (`OwnedVolume → TrackedEdition → Manga`).
 *
 * Consulta relacional ÚNICA sobre `OwnedVolume` (un `findMany` con `select` anidado): una fila de `OwnedVolume`
 * **es** un tomo poseído (el legado es booleano), así que devuelve exactamente los tomos marcados como poseídos.
 * Una sentencia = un snapshot; las relaciones son requeridas (`OwnedVolume.editionId`, `TrackedEdition.mangaId`
 * no nulos) ⇒ Prisma las tipa no-null ⇒ cada observación sale completa.
 *
 * Límites de responsabilidad:
 *  - Devuelve SOLO tomos poseídos (filas de `OwnedVolume`).
 *  - NO consulta Collection; NO deriva `publisherKey`; NO resuelve correspondencias.
 *  - NO deduplica: una observación por fila persistida, cada una con su `ownedVolumeId` (= `OwnedVolume.id`). Si dos
 *    filas colapsaran en la misma tripla derivada, ambas se devuelven distinguibles (la ambigüedad se diagnostica
 *    aguas abajo, no se oculta acá).
 *  - Pasa `Manga.anilistId` **tal cual** (ya codifica la convención: positivo = AniList, negativo = `-workId` para
 *    obra local), `TrackedEdition.key` y `OwnedVolume.volume` fieles; no filtra valores "sospechosos" (p.ej.
 *    `anilistId = 0`): lo decide el mapping.
 *  - NO toca la escritura legada (`lib/collection.ts`): sólo lee.
 */
import type { PrismaClient } from "@prisma/client";
import type { LegacyObservation, OwnershipSource } from "@/lib/collection-read/ports";

/** Fuente de posesión sobre el legado. Orden determinista por `OwnedVolume.id asc`. */
export function legacyOwnershipSource(client: PrismaClient): OwnershipSource<LegacyObservation> {
  return {
    async observe(userId: string): Promise<readonly LegacyObservation[]> {
      const owned = await client.ownedVolume.findMany({
        where: { edition: { manga: { userId } } },
        orderBy: { id: "asc" },
        select: {
          id: true, // ownedVolumeId (identidad persistida estable)
          volume: true, // OwnedVolume.volume (número de tomo)
          edition: {
            select: {
              key: true, // TrackedEdition.key
              manga: { select: { anilistId: true } }, // Manga.anilistId (positivo o -workId)
            },
          },
        },
      });

      return owned.map((o) => ({
        ownedVolumeId: o.id,
        anilistId: o.edition.manga.anilistId,
        editionKey: o.edition.key,
        volume: o.volume,
      }));
    },
  };
}
