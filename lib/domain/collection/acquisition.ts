/**
 * Dominio de Collection (Slice 8) — `Acquisition`: hecho histórico INMUTABLE e idempotente de entrada de
 * unidades a la colección. PURO (sin Prisma, sin reloj global, sin generación de ids: la clave y `occurredAt`
 * vienen dados por el hecho fuente). Idempotencia anclada en `acquisitionKey`; la reconciliación compara el
 * PAYLOAD de cinco atributos de dominio (userId, volumeId, quantity, channel, occurredAt). `recordedAt` es un
 * dato técnico del procesamiento y NO participa. Ver ADR-010 §D5/§D6.
 */
import { CollectionError, COLLECTION_ERROR } from "@/lib/domain/collection/errors";

/** Canal de procedencia de una adquisición. Obligatorio; Collection NO lo infiere (lo fija el proyector). */
export const ACQUISITION_CHANNEL = {
  RETAIL_PICKUP: "RETAIL_PICKUP",
  // Backfill del modelo legado `OwnedVolume` → Collection (F2.2, ADR-012): procedencia de una posesión importada
  // del legado booleano, distinta de un pickup real. No altera el flujo de Slice 8 (adición estrictamente aditiva).
  LEGACY_BACKFILL: "LEGACY_BACKFILL",
} as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNEL)[keyof typeof ACQUISITION_CHANNEL];

/**
 * Los cinco atributos de dominio del hecho (el "payload" de reconciliación). Excluye `acquisitionKey` (que es
 * la identidad, compartida por construcción) y `recordedAt` (técnico).
 */
export interface AcquisitionPayload {
  readonly userId: string;
  readonly volumeId: number;
  readonly quantity: number;
  readonly channel: string;
  readonly occurredAt: Date;
}

/** El hecho completo: identidad estable/opaca + payload. */
export interface AcquisitionFact extends AcquisitionPayload {
  readonly acquisitionKey: string;
}

function isNonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}
function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Valida que un hecho esté bien formado (PURO). `quantity` es la invariante central (entero > 0). El resto de
 * los campos identifican el hecho y su destino: se rechaza cualquier forma inválida antes de intentar aplicar.
 */
export function assertValidAcquisition(fact: AcquisitionFact): void {
  if (!Number.isInteger(fact.quantity) || fact.quantity <= 0)
    throw new CollectionError(COLLECTION_ERROR.INVALID_QUANTITY, "la cantidad debe ser un entero > 0");
  if (!isNonEmpty(fact.acquisitionKey)) throw new CollectionError(COLLECTION_ERROR.INVALID_ACQUISITION, "acquisitionKey vacía");
  if (!isNonEmpty(fact.userId)) throw new CollectionError(COLLECTION_ERROR.INVALID_ACQUISITION, "userId vacío");
  if (!isNonEmpty(fact.channel)) throw new CollectionError(COLLECTION_ERROR.INVALID_ACQUISITION, "channel vacío");
  if (!Number.isInteger(fact.volumeId) || fact.volumeId <= 0) throw new CollectionError(COLLECTION_ERROR.INVALID_ACQUISITION, "volumeId inválido");
  if (!isValidDate(fact.occurredAt)) throw new CollectionError(COLLECTION_ERROR.INVALID_ACQUISITION, "occurredAt inválido");
}

/**
 * Compara los cinco atributos de dominio de dos payloads (PURO). `occurredAt` por instante exacto (`getTime`).
 * NO compara `acquisitionKey` (idéntica por construcción) ni `recordedAt` (técnico).
 */
export function samePayload(a: AcquisitionPayload, b: AcquisitionPayload): boolean {
  return (
    a.userId === b.userId &&
    a.volumeId === b.volumeId &&
    a.quantity === b.quantity &&
    a.channel === b.channel &&
    a.occurredAt.getTime() === b.occurredAt.getTime()
  );
}

/**
 * Reconcilia un intento que reusa una `acquisitionKey` ya persistida (PURO; espeja `reconcileOperationKey` de
 * Retail):
 *  - sin hecho previo → `false` (es nuevo, hay que insertarlo);
 *  - hecho previo con el MISMO payload → `true` (idempotente: ya aplicado, no-op);
 *  - hecho previo con payload DISTINTO → `ACQUISITION_KEY_CONFLICT`.
 * Nunca devuelve éxito silencioso para un hecho distinto que reusó la clave.
 */
export function reconcileAcquisition(existing: AcquisitionPayload | null, fact: AcquisitionFact): boolean {
  if (!existing) return false;
  if (samePayload(existing, fact)) return true;
  throw new CollectionError(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT, "la acquisitionKey ya se usó para otro hecho");
}
