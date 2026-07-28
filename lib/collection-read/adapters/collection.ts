/**
 * Adapter Collection del read-side unificado (ADR-011, Slice 9 / Checkpoint 3): implementa
 * `OwnershipSource<CollectionObservation>` sobre el modelo de Slice 8.
 *
 * Consulta relacional ÚNICA `OwnershipPosition → Volume → PublisherEdition` (un solo `findMany` con `select`
 * anidado). Una sola sentencia = un solo snapshot: elimina la ventana entre dos lecturas y no depende de un nivel
 * de aislamiento especial. Las relaciones son requeridas (`Position.volumeId`, `Volume.editionId` no nulos), así
 * que Prisma las tipa no-null y cada observación sale completa; no hay caso de "edición ausente" que defender.
 * (No se reutiliza `getUserPositions` de Slice 8: no incluye la edición y ampliarlo modificaría Slice 8; la
 * atomicidad de la observación pesa más que el reúso. Slice 8 queda intacto.)
 *
 * Límites de responsabilidad: el adapter NO fabrica claves ni ejecuta `deriveCatalogKey` (eso pertenece al mapping
 * puro); NO filtra `quantity = 0` (Collection las necesita para ejercer autoridad); pasa `anilistId`/`workId` null
 * fieles (obra sin ancla → el mapping decidirá `unmappableCatalog`).
 */
import type { PrismaClient } from "@prisma/client";
import type { CollectionObservation, OwnershipSource } from "@/lib/collection-read/ports";

/** Fuente de posesión sobre Collection (Slice 8). Orden determinista por `volumeId asc`. */
export function collectionOwnershipSource(client: PrismaClient): OwnershipSource<CollectionObservation> {
  return {
    async observe(userId: string): Promise<readonly CollectionObservation[]> {
      const positions = await client.ownershipPosition.findMany({
        where: { userId },
        orderBy: { volumeId: "asc" },
        select: {
          volumeId: true,
          quantity: true, // incluye 0 (no se filtra)
          volume: {
            select: {
              number: true,
              edition: { select: { anilistId: true, workId: true, publisher: true } },
            },
          },
        },
      });

      // Identidad de catálogo tal cual persiste (anilistId/workId pueden ser null → obra sin ancla, fieles). NO se
      // deriva ninguna clave acá. `volume` y `volume.edition` son relaciones requeridas ⇒ presentes por tipo.
      return positions.map((p) => ({
        volumeId: p.volumeId,
        quantity: p.quantity,
        number: p.volume.number,
        anilistId: p.volume.edition.anilistId,
        workId: p.volume.edition.workId,
        publisher: p.volume.edition.publisher,
      }));
    },
  };
}
