/**
 * Dominio de Collection (Slice 8) — errores de dominio con `code` estable. PURO. Namespace PROPIO del bounded
 * context (no reusa `RetailError`: aislamiento de contextos). Los conflictos de base (P2002/P2003) se TRADUCEN
 * a estos códigos en la infra (lib/collection-context/*), nunca se dependen de mensajes de Prisma como contrato.
 */
export const COLLECTION_ERROR = {
  INVALID_QUANTITY: "INVALID_QUANTITY", // cantidad de una adquisición no es un entero > 0
  INVALID_ACQUISITION: "INVALID_ACQUISITION", // hecho mal formado (clave/usuario/canal vacío, volumen o fecha inválidos)
  ACQUISITION_KEY_CONFLICT: "ACQUISITION_KEY_CONFLICT", // misma acquisitionKey con un payload distinto
  NEGATIVE_POSITION: "NEGATIVE_POSITION", // aplicar dejaría la posición < 0 (o el estado actual ya es inválido)
} as const;
export type CollectionErrorCode = (typeof COLLECTION_ERROR)[keyof typeof COLLECTION_ERROR];

export class CollectionError extends Error {
  constructor(readonly code: CollectionErrorCode, message?: string) {
    super(message ?? `collection: ${code}`);
    this.name = "CollectionError";
  }
}
