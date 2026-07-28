/**
 * Dominio del subsistema de Identidad — slice "Fusionar dos identidades". PURO (Prisma-free).
 * TERCERA mutación del namespace (tras Conferir y Asociar) y la primera MULTI-identidad.
 *
 * Fusionar declara que dos handles que hoy representan identidades ACTIVE distintas corresponden a una
 * misma identidad: conserva una SOBREVIVIENTE (la nombra Adjudicación) y transforma la otra (ABSORBIDA)
 * en una REDIRECCIÓN permanente hacia la sobreviviente. Ambos handles se preservan; ninguno se recicla.
 *
 * La DIRECCIÓN importa: `(survivor=A, absorbed=B)` ≠ `(survivor=B, absorbed=A)` — son decisiones
 * distintas. La huella NO ordena los handles como conjunto (a diferencia de las referencias semilla de
 * Conferir, cuyo orden no significa nada).
 *
 * Este módulo construye/valida la Decisión, su huella semántica y la unión de Resultados. NO conoce el
 * namespace, el lock, ni Catálogo (eso es del Registro/coordinador en infra/aplicación). La política de
 * contenido viaja como un `MergePlan` de Catálogo (v1: re-parentar ediciones, sin combinar hechos).
 */
import { ValidationError } from "@/lib/mutations";
import { MERGE_PLAN_V1, type MergePlan } from "@/lib/domain/catalog/absorbWork";

/** Estado que produce una fusión sobre la identidad absorbida. La sobreviviente permanece ACTIVE. */
export const IDENTITY_STATE_REDIRECTED = "REDIRECTED" as const;

/**
 * La Decisión Fusionar (intención juzgada por Adjudicación, no instrucciones de persistencia). Inmutable.
 * `catalogMergePlan` es la política de contenido YA decidida (v1: la única estrategia versionada). No
 * lleva campos técnicos de persistencia (redirectsToId, estados leídos, ids de fila): esos son del Registro.
 */
export interface MergeDecision {
  readonly decisionId: string;
  readonly survivingHandle: number;
  readonly absorbedHandle: number;
  readonly catalogMergePlan: MergePlan;
}

export interface MergeDecisionInput {
  decisionId: string;
  survivingHandle: number;
  absorbedHandle: number;
  catalogMergePlan?: MergePlan;
}

/**
 * Construye y VALIDA la Decisión Fusionar. Exige decisionId estable, ambos handles válidos y DISTINTOS
 * (un self-merge es una decisión malformada, no un resultado — §3), y un plan de contenido versionado.
 * El Registro, además, revalida la distinción bajo lock y expone `SAME_IDENTITY` como red de seguridad
 * ante decisiones construidas a mano (no por este constructor).
 */
export function mergeDecision(input: MergeDecisionInput): MergeDecision {
  const decisionId = (input.decisionId ?? "").trim();
  if (!decisionId) throw new ValidationError("La decisión Fusionar requiere un decisionId estable.");

  if (!Number.isInteger(input.survivingHandle) || input.survivingHandle <= 0)
    throw new ValidationError("La decisión Fusionar requiere un handle sobreviviente válido.");
  if (!Number.isInteger(input.absorbedHandle) || input.absorbedHandle <= 0)
    throw new ValidationError("La decisión Fusionar requiere un handle absorbido válido.");
  if (input.survivingHandle === input.absorbedHandle)
    throw new ValidationError("La decisión Fusionar requiere handles distintos (no se puede fusionar una identidad consigo misma).");

  const plan = input.catalogMergePlan ?? MERGE_PLAN_V1;
  if (plan.version !== 1)
    throw new ValidationError(`MergePlan versión no soportada: ${String((plan as { version?: unknown }).version)}.`);

  return Object.freeze({
    decisionId,
    survivingHandle: input.survivingHandle,
    absorbedHandle: input.absorbedHandle,
    catalogMergePlan: MERGE_PLAN_V1,
  });
}

/**
 * Identidad SEMÁNTICA de la Decisión Fusionar, canónica y estable: sobreviviente + absorbida + plan de
 * contenido. La DIRECCIÓN importa (no se ordenan como conjunto). NO incluye ids de fila técnicos (más allá
 * de los handles, que SON el contenido de la decisión), timestamps, estados leídos, cantidades movidas ni
 * `redirectsToId`. `v:1` versiona el formato. Se persiste al fusionar (en la absorbida) y se compara por
 * igualdad exacta en el replay.
 */
export function mergeDecisionFingerprint(d: MergeDecision): string {
  return JSON.stringify({
    v: 1,
    survivor: d.survivingHandle,
    absorbed: d.absorbedHandle,
    catalogPlan: { v: d.catalogMergePlan.version },
  });
}

/** Predicado LOCAL: ¿el estado habilita a una identidad como SOBREVIVIENTE de una fusión? Solo ACTIVE sin redirect. */
export function isSurvivorState(state: string, redirectsToId: number | null): boolean {
  return state === "ACTIVE" && redirectsToId === null;
}
/** Predicado LOCAL: ¿el estado habilita a una identidad para ser ABSORBIDA? Solo ACTIVE sin redirect. */
export function isAbsorbableState(state: string, redirectsToId: number | null): boolean {
  return state === "ACTIVE" && redirectsToId === null;
}

/** Motivos de rechazo de dominio (códigos, no detalles de base). Solo los REALMENTE alcanzables. */
export const MERGE_REASON = {
  /** Sobreviviente y absorbida son la misma identidad (red de seguridad; el constructor ya lo rechaza). */
  SAME_IDENTITY: "SAME_IDENTITY",
  /** Falta la sobreviviente o la absorbida (el detalle indica cuál). */
  IDENTITY_NOT_FOUND: "IDENTITY_NOT_FOUND",
  /** La sobreviviente no está ACTIVE (p. ej. ya redirigida). */
  INVALID_SURVIVOR_STATE: "INVALID_SURVIVOR_STATE",
  /** La absorbida no está ACTIVE (ya redirige a OTRA sobreviviente, o estado inválido). */
  INVALID_ABSORBED_STATE: "INVALID_ABSORBED_STATE",
  /** Clases de contenido incompatibles entre ambas identidades. */
  CONTENT_CLASS_INCOMPATIBLE: "CONTENT_CLASS_INCOMPATIBLE",
  /** La absorbida tiene redirecciones ENTRANTES; v1 no compacta cadenas. */
  REDIRECT_DEPENDENTS_PRESENT: "REDIRECT_DEPENDENTS_PRESENT",
  /** El `decisionId` ya existe con otra huella (reuso divergente). */
  DECISION_ID_REUSED_DIVERGENTLY: "DECISION_ID_REUSED_DIVERGENTLY",
  /** Catálogo no pudo reconciliar el contenido (colisión de slot de edición) → requiere juicio. */
  CONTENT_CONFLICT_REQUIRES_JUDGMENT: "CONTENT_CONFLICT_REQUIRES_JUDGMENT",
} as const;
export type MergeReason = (typeof MERGE_REASON)[keyof typeof MERGE_REASON];

/** Cuál identidad falta (para `IDENTITY_NOT_FOUND`). */
export type MissingIdentity = "survivor" | "absorbed";
/** Slot de edición en conflicto (propagado desde Catálogo, sin filtrar filas Prisma). */
export interface MergeEditionConflict {
  readonly publisher: string;
  readonly language: string;
}

/** Handles que resultaron de una fusión (lo que exponen EXECUTED / ALREADY_*). */
export interface MergedHandles {
  readonly survivingHandle: number;
  readonly absorbedHandle: number;
}

/**
 * Resultado de ejecución de Fusionar (variantes REALMENTE alcanzables). Distingue explícitamente cuatro
 * situaciones "ya está así":
 * - `ALREADY_SATISFIED`: replay de la MISMA decisión (misma huella).
 * - `ALREADY_MERGED`: la absorbida YA redirige a la misma sobreviviente, pero por OTRA decisión.
 * - `DECISION_ID_REUSED_DIVERGENTLY`: mismo decisionId, huella distinta.
 * - `REJECTED`/`INVALID_ABSORBED_STATE`: la absorbida redirige a OTRA (contradicción, no idempotencia).
 *
 * `EXECUTED` expone información semántica útil (handles, Works, ediciones re-parentadas por Catálogo,
 * referencias movidas por el namespace). NO se exponen modelos Prisma. NO figuran resultados inalcanzables:
 * `WOULD_CREATE_REDIRECT_CYCLE` (subsumido por INVALID_SURVIVOR_STATE bajo la regla anti-cadena v1: un
 * ciclo exigiría que la sobreviviente ya redirija, imposible si es ACTIVE) ni `STALE_DECISION` (en v1 una
 * decisión obsoleta se manifiesta como INVALID_*_STATE / ALREADY_MERGED, sin precondición extra separable).
 */
export type MergeResult =
  | {
      readonly kind: "EXECUTED";
      readonly survivingHandle: number;
      readonly absorbedHandle: number;
      readonly survivingWorkId: number;
      readonly absorbedWorkId: number;
      readonly reparentedEditions: number;
      readonly movedReferences: number;
    }
  | { readonly kind: "ALREADY_SATISFIED"; readonly handles: MergedHandles }
  | { readonly kind: "ALREADY_MERGED"; readonly handles: MergedHandles }
  | {
      readonly kind: "REJECTED";
      readonly reason: MergeReason;
      readonly message: string;
      readonly missing?: MissingIdentity;
      readonly conflicts?: readonly MergeEditionConflict[];
    };

export const mergeExecuted = (p: {
  survivingHandle: number;
  absorbedHandle: number;
  survivingWorkId: number;
  absorbedWorkId: number;
  reparentedEditions: number;
  movedReferences: number;
}): MergeResult => ({ kind: "EXECUTED", ...p });
export const mergeAlreadySatisfied = (handles: MergedHandles): MergeResult => ({ kind: "ALREADY_SATISFIED", handles });
export const mergeAlreadyMerged = (handles: MergedHandles): MergeResult => ({ kind: "ALREADY_MERGED", handles });
export const mergeRejected = (
  reason: MergeReason,
  message: string,
  extra: { missing?: MissingIdentity; conflicts?: readonly MergeEditionConflict[] } = {},
): MergeResult => ({ kind: "REJECTED", reason, message, ...extra });

/**
 * Puerto del caso de uso Fusionar (aplicación). La app lo implementa componiendo Catálogo + Registro en
 * UNA transacción. Recibe una Decisión y devuelve un Resultado de ejecución semántico.
 */
export interface MergeIdentitiesUseCase {
  merge(decision: MergeDecision): Promise<MergeResult>;
}

/**
 * Adjudicación (costura de juicio): DECIDE que dos identidades son la misma, cuál sobrevive y la política
 * de contenido; emite la Decisión. NO escribe el namespace, NO invierte la dirección, NO substituye handles
 * por terminales, NO persiste. Estructuralmente solo construye la Decisión (dependencia pura).
 */
export function adjudicateMergeIdentities(request: MergeDecisionInput): MergeDecision {
  return mergeDecision(request);
}
