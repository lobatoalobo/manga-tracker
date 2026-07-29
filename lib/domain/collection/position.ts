/**
 * Dominio de Collection (Slice 8) — `OwnershipPosition`: Aggregate Root deliberadamente pequeño que custodia la
 * posesión presente del par (userId, volumeId) y APLICA adquisiciones de forma consistente. PURO. Hoy el
 * negocio es append-only: `quantity = Σ Acquisition` del par y sólo crece. La no-negatividad es la invariante
 * que se preserva (defensiva ante un futuro `Disposal`; ver ADR-010 §D2).
 */
import { CollectionError, COLLECTION_ERROR } from "@/lib/domain/collection/errors";
import { assertValidAcquisition, type AcquisitionFact } from "@/lib/domain/collection/acquisition";

/**
 * Aplica un hecho sobre la cantidad actual de la posición y devuelve la nueva cantidad (PURO). El
 * comportamiento vive en el agregado; la `Acquisition` es sólo el hecho. Valida el hecho y preserva
 * `quantity >= 0`.
 */
export function applyAcquisition(currentQuantity: number, fact: AcquisitionFact): number {
  assertValidAcquisition(fact);
  if (!Number.isInteger(currentQuantity) || currentQuantity < 0)
    throw new CollectionError(COLLECTION_ERROR.NEGATIVE_POSITION, "la cantidad actual de la posición es inválida");
  const next = currentQuantity + fact.quantity;
  if (next < 0) throw new CollectionError(COLLECTION_ERROR.NEGATIVE_POSITION, "aplicar dejaría la posición en negativo");
  return next;
}

/**
 * Reconstruye la cantidad de una posición como Σ de las cantidades de sus adquisiciones (PURO). Es la fuente de
 * verdad recomputable que respalda `OwnershipPosition.quantity` (auditoría/reparación).
 */
export function reconstructQuantity(facts: readonly AcquisitionFact[]): number {
  return facts.reduce((sum, f) => {
    assertValidAcquisition(f);
    return sum + f.quantity;
  }, 0);
}
