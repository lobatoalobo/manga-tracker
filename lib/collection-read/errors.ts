/**
 * Errores del read-side unificado (ADR-011, Slice 9). Convención del repo: mapa de códigos estables + clase con
 * `code` tipado (espeja `lib/domain/collection/errors.ts` de Slice 8).
 */
export const MERGE_ERROR = {
  MISSING_OBSERVATION: "MISSING_OBSERVATION", // volumeId requerido por la resolución sin CollectionObservation
  DUPLICATE_OBSERVATION: "DUPLICATE_OBSERVATION", // ≥2 observaciones con el mismo volumeId
  EXTRANEOUS_OBSERVATION: "EXTRANEOUS_OBSERVATION", // observación cuyo volumeId no aparece en la resolución
  NEGATIVE_QUANTITY: "NEGATIVE_QUANTITY", // observación semánticamente inválida (quantity < 0)
} as const;

export type MergeErrorCode = (typeof MERGE_ERROR)[keyof typeof MERGE_ERROR];

/**
 * Entrada inválida a `mergeOwnership`: la resolución de correspondencia y las observaciones de Collection no cumplen
 * la biyección requerida, o una observación es semánticamente inválida. El core NUNCA degrada silenciosamente a
 * `quantity = 0` ni produce un resultado parcial: una inconsistencia técnica no puede convertirse en una afirmación
 * de dominio falsa (p.ej. suprimir el legado por una observación faltante).
 */
export class InvalidMergeInput extends Error {
  readonly code: MergeErrorCode;
  constructor(code: MergeErrorCode, message: string) {
    super(message);
    this.name = "InvalidMergeInput";
    this.code = code;
  }
}
