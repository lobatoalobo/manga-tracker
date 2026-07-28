/**
 * Puerto de fuente de posesión (ADR-011, Slice 9 / Checkpoint 2). Abstracción hexagonal: una `OwnershipSource`
 * **observa** la posesión de un usuario en UNA fuente. Los adapters concretos (Collection sobre Slice 8, legado
 * sobre `lib/collection.ts`) son checkpoints posteriores; acá sólo vive el contrato y las formas de observación.
 *
 * Separación de responsabilidades (no mezclar): la fuente **obtiene observaciones**; la correspondencia
 * (`mapping/correspondence`) **determina equivalencias y ambigüedades**; el merge (`merge`) **aplica la autoridad
 * de Collection y el backstop legado**. El puerto es async porque cruza la frontera de infra (los adapters hacen
 * DB); el core de merge es puro y NO llama al puerto: consume observaciones ya cargadas.
 */
import type { CatalogVolumeRef, LegacyTomoRef } from "@/lib/collection-read/mapping/correspondence";

/**
 * Observación de Collection: una posición `(volumeId, quantity)` **más** la identidad de catálogo que la ubica en
 * el eje legado (el adapter la resuelve desde `Volume` → `PublisherEdition`). El subconjunto `CatalogVolumeRef`
 * alimenta la correspondencia; `quantity` alimenta el merge. `quantity` puede ser 0 (afirmación válida de no
 * posesión, típicamente post-`Disposal`).
 */
export type CollectionObservation = CatalogVolumeRef & { quantity: number };

/**
 * Observación del legado: un tomo poseído. El legado es **booleano** (la fila `OwnedVolume` existe ⇒ poseído), así
 * que no lleva cantidad. Además de la coordenada de correspondencia (`LegacyTomoRef`), lleva `ownedVolumeId`
 * (= `OwnedVolume.id`), una **identidad persistida estable**.
 *
 * `ownedVolumeId` **NO participa de la correspondencia** (la tripla `(seriesKey, editionKey, number)` sigue
 * decidiendo equivalencias; `deriveLegacyKey` no lo lee). Su función es preservar la distinción entre filas
 * persistidas distintas que **colapsen** en la misma tripla derivada: permite distinguir observaciones colisionadas,
 * reconciliar, auditar y evitar keys duplicadas en DTOs posteriores. Sin él, dos filas colisionadas serían
 * indistinguibles.
 */
export type LegacyObservation = LegacyTomoRef & { ownedVolumeId: number };

/** Fuente de observaciones de posesión de un usuario. Implementada por los adapters concretos (checkpoints 3/4). */
export interface OwnershipSource<TObservation> {
  observe(userId: string): Promise<readonly TObservation[]>;
}
