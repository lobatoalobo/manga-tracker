/**
 * Dominio de Collection (Slice 8) — vocabulario de RESULTADOS de proyección de un evento `PICKED_UP`. PURO
 * (constantes de dominio). Los resultados esperables se modelan como valores, NO como excepciones genéricas.
 * El dominio define el vocabulario; el proyector (lib/collection-context/*, Paso 5) es quien los PRODUCE:
 *
 *  - APPLIED                    — se creó la Acquisition y se incrementó la posición.
 *  - ALREADY_APPLIED            — el hecho ya estaba aplicado (mismo payload): no-op idempotente.
 *  - TERMINALLY_NOT_APPLICABLE  — el destino (cuenta) fue eliminado deliberadamente: no aplica y no reaparece.
 *  - CONFLICT                   — misma acquisitionKey con payload distinto (no debería ocurrir: fuente inmutable).
 *  - CORRUPT_SOURCE             — hecho PICKED_UP sin `ownerUserIdSnapshot`: inesperado → alarma, no aplica.
 *  - RETRYABLE_FAILURE          — fallo transitorio de infraestructura: se reintenta en el próximo barrido.
 *  - PENDING_CATALOG_RESOLUTION — la línea no tiene `volumeId` (oferta manual aún sin identidad de catálogo):
 *                                 estado BENIGNO, no aplica ni falla, y NO reingresa al barrido (sin reintentos
 *                                 inútiles) hasta que exista un Volume. Distinto de CORRUPT (que es alarma).
 */
export const PROJECTION_RESULT = {
  APPLIED: "APPLIED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  TERMINALLY_NOT_APPLICABLE: "TERMINALLY_NOT_APPLICABLE",
  CONFLICT: "CONFLICT",
  CORRUPT_SOURCE: "CORRUPT_SOURCE",
  RETRYABLE_FAILURE: "RETRYABLE_FAILURE",
  PENDING_CATALOG_RESOLUTION: "PENDING_CATALOG_RESOLUTION",
} as const;
export type ProjectionResult = (typeof PROJECTION_RESULT)[keyof typeof PROJECTION_RESULT];
