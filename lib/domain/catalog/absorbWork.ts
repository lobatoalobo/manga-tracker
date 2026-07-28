/**
 * Dominio de Catálogo — "absorber un Work dentro de otro" (dependencia de ADR-008 para la futura
 * Fusionar). PURO (Prisma-free). Esta operación pertenece a CATÁLOGO: NO fusiona identidades, NO toca
 * `CatalogIdentity`. Deja el Work sobreviviente como contenido activo, re-parenta las ediciones del
 * absorbido y marca al absorbido con `absorbedIntoId` (detached; nunca se borra — perpetuidad).
 *
 * Alcance v1 (ADR-008): re-parenta ediciones; NO combina hechos descriptivos (los del absorbido quedan
 * archivados en el Work absorbido). Catálogo NO decide cómo reconciliar hechos contradictorios ni
 * ediciones que colisionan: eso requiere juicio → `CONTENT_CONFLICT_REQUIRES_JUDGMENT`.
 */
import { ValidationError } from "@/lib/mutations";

/**
 * Plan de absorción. v1 es VACÍO/versionado a propósito (la única estrategia es "re-parentar
 * ediciones, sin combinar hechos"). Reserva el slot para estrategias futuras SIN estructura
 * especulativa. Autoridad: lo provee el futuro coordinador de Fusionar (Adjudicación); habilita
 * validar la versión. Si faltara, la operación no puede ejecutarse (versión desconocida).
 */
export interface MergePlan {
  readonly version: 1;
}
export const MERGE_PLAN_V1: MergePlan = Object.freeze({ version: 1 });

/** Comando de absorción (intención de Catálogo, no instrucciones de persistencia). */
export interface AbsorbWorkCommand {
  readonly survivingWorkId: number;
  readonly absorbedWorkId: number;
  readonly mergePlan: MergePlan;
}

export interface AbsorbWorkInput {
  survivingWorkId: number;
  absorbedWorkId: number;
  mergePlan?: MergePlan;
}

/** Construye y valida el comando (ids positivos, plan versionado). `SAME_WORK` NO se rechaza acá: es
 * un resultado semántico (lo detecta el write-port), no una malformación del comando. */
export function absorbWorkCommand(input: AbsorbWorkInput): AbsorbWorkCommand {
  if (!Number.isInteger(input.survivingWorkId) || input.survivingWorkId <= 0)
    throw new ValidationError("survivingWorkId inválido.");
  if (!Number.isInteger(input.absorbedWorkId) || input.absorbedWorkId <= 0)
    throw new ValidationError("absorbedWorkId inválido.");
  const mergePlan = input.mergePlan ?? MERGE_PLAN_V1;
  if (mergePlan.version !== 1) throw new ValidationError(`MergePlan versión no soportada: ${String((mergePlan as { version?: unknown }).version)}.`);
  return Object.freeze({ survivingWorkId: input.survivingWorkId, absorbedWorkId: input.absorbedWorkId, mergePlan: MERGE_PLAN_V1 });
}

/** Predicado LOCAL: un Work es contenido activo (utilizable) sii no fue absorbido. */
export function isActiveWork(absorbedIntoId: number | null): boolean {
  return absorbedIntoId === null;
}

/** Motivos de rechazo (códigos de dominio, no detalles de base). */
export const ABSORB_REASON = {
  /** Sobreviviente y absorbido son el mismo Work. */
  SAME_WORK: "SAME_WORK",
  /** Falta el sobreviviente o el absorbido (el detalle indica cuál). */
  WORK_NOT_FOUND: "WORK_NOT_FOUND",
  /** El sobreviviente está absorbido (no puede recibir contenido). */
  INVALID_SURVIVOR_STATE: "INVALID_SURVIVOR_STATE",
  /** El absorbido ya está absorbido en OTRO Work, o tiene absorciones entrantes (v1 no encadena). */
  INVALID_ABSORBED_STATE: "INVALID_ABSORBED_STATE",
  /** Colisión de contenido (ediciones que comparten publisher+idioma) que Catálogo no puede resolver. */
  CONTENT_CONFLICT_REQUIRES_JUDGMENT: "CONTENT_CONFLICT_REQUIRES_JUDGMENT",
} as const;
export type AbsorbReason = (typeof ABSORB_REASON)[keyof typeof ABSORB_REASON];

/** Cuál Work falta (para `WORK_NOT_FOUND`). */
export type MissingWork = "survivor" | "absorbed";
/** Slot de edición en conflicto (para `CONTENT_CONFLICT_REQUIRES_JUDGMENT`). Sin filtrar filas Prisma. */
export interface EditionConflict {
  readonly publisher: string;
  readonly language: string;
}

/**
 * Resultado de dominio (NO modelos Prisma). `EXECUTED` (absorción aplicada), `ALREADY_ABSORBED` (estado
 * ya satisfecho: el absorbido ya apunta al mismo sobreviviente), y `REJECTED` con su motivo. No hay
 * `decisionId`/replay: el protocolo de decisión pertenece al futuro caso de uso de Fusionar (ADR-008),
 * no a Catálogo. `WOULD_CREATE_ABSORPTION_CYCLE` NO figura: en v1 (ambos deben ser activos, sin cadenas)
 * un ciclo queda subsumido por INVALID_SURVIVOR_STATE / INVALID_ABSORBED_STATE (no es alcanzable).
 */
export type CatalogAbsorptionResult =
  | { readonly kind: "EXECUTED"; readonly survivingWorkId: number; readonly absorbedWorkId: number; readonly reparentedEditions: number }
  | { readonly kind: "ALREADY_ABSORBED"; readonly survivingWorkId: number; readonly absorbedWorkId: number }
  | { readonly kind: "REJECTED"; readonly reason: AbsorbReason; readonly message: string; readonly missing?: MissingWork; readonly conflicts?: readonly EditionConflict[] };

export const absorbExecuted = (survivingWorkId: number, absorbedWorkId: number, reparentedEditions: number): CatalogAbsorptionResult =>
  ({ kind: "EXECUTED", survivingWorkId, absorbedWorkId, reparentedEditions });
export const absorbAlreadyAbsorbed = (survivingWorkId: number, absorbedWorkId: number): CatalogAbsorptionResult =>
  ({ kind: "ALREADY_ABSORBED", survivingWorkId, absorbedWorkId });
export const absorbRejected = (
  reason: AbsorbReason,
  message: string,
  extra: { missing?: MissingWork; conflicts?: readonly EditionConflict[] } = {},
): CatalogAbsorptionResult => ({ kind: "REJECTED", reason, message, ...extra });
