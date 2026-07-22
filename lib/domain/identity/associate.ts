/**
 * Dominio del subsistema de Identidad — slice "Asociar una referencia externa a una Identity
 * existente". PURO (Prisma-free). Segunda mutación del namespace.
 *
 * La referencia externa pertenece al NAMESPACE (no es estado local de Identity, no la define; es
 * evidencia subordinada). Esta operación NO crea una Identity ni crea contenido: solo hace que una
 * referencia `(provider, externalId)` pase a resolver hacia una Identity destino existente.
 *
 * Vocabulario y semántica alineados con Conferir, pero con una identidad semántica DISTINTA
 * (destino + referencia; sin clase ni conjunto de referencias). Idempotencia de DECISIÓN
 * (`ALREADY_SATISFIED`, misma huella) se distingue explícitamente de idempotencia por ESTADO
 * (`ALREADY_ASSOCIATED`, la referencia ya resolvía al mismo destino por OTRA decisión).
 */
import { ValidationError } from "@/lib/mutations";
import { IDENTITY_STATE_ACTIVE } from "@/lib/domain/identity/confer";

/** La Decisión Asociar (intención, no mutación). Inmutable una vez construida. */
export interface AssociateExternalReferenceDecision {
  readonly decisionId: string;
  readonly targetHandle: number; // handle de la Identity destino
  readonly provider: string;
  readonly externalId: string;
}

export interface AssociateExternalReferenceInput {
  decisionId: string;
  targetHandle: number;
  provider: string;
  externalId: string;
}

/**
 * Construye y VALIDA la Decisión Asociar. Exige decisionId, destino y referencia. Normaliza (trim)
 * consistente con Conferir. La referencia es un único value object → no hay orden que canonicalizar.
 */
export function associateExternalReferenceDecision(input: AssociateExternalReferenceInput): AssociateExternalReferenceDecision {
  const decisionId = (input.decisionId ?? "").trim();
  if (!decisionId) throw new ValidationError("La decisión Asociar requiere un decisionId estable.");

  if (!Number.isInteger(input.targetHandle) || input.targetHandle <= 0)
    throw new ValidationError("La decisión Asociar requiere un handle de Identity destino válido.");

  const provider = (input.provider ?? "").trim();
  const externalId = (input.externalId ?? "").trim();
  if (!provider || !externalId) throw new ValidationError("La referencia externa requiere provider y externalId.");

  return Object.freeze({ decisionId, targetHandle: input.targetHandle, provider, externalId });
}

/**
 * Identidad SEMÁNTICA de la Decisión Asociar, canónica y estable: destino + referencia. NO incluye
 * clase ni conjunto de referencias (a diferencia de Conferir). `v:1` versiona el formato. Se
 * persiste al asociar y se compara por igualdad exacta en el replay.
 */
export function associateDecisionFingerprint(d: AssociateExternalReferenceDecision): string {
  return JSON.stringify({ v: 1, h: d.targetHandle, p: d.provider, e: d.externalId });
}

/**
 * Predicado LOCAL de una Identity: ¿su estado la habilita como destino legal de una referencia?
 * Solo `ACTIVE`. Regla FUTURA (no representable aún: solo existe ACTIVE en persistencia): una
 * Identity REDIRIGIDA se rechaza (Adjudicación debe nombrar el handle terminal — el Registro no
 * substituye el destino); una RETIRADA se rechaza. Ambos → INVALID_IDENTITY_STATE.
 */
export function isAssociableState(state: string): boolean {
  return state === IDENTITY_STATE_ACTIVE;
}

/** Invariantes de dominio que el Registro puede reportar infringidos al asociar. */
export const ASSOCIATE_INVARIANT = {
  /** La referencia ya resuelve hacia OTRA identidad (unicidad de referencia). */
  REFERENCE_ALREADY_BOUND: "REFERENCE_ALREADY_BOUND",
  /** El handle destino no existe (no-colgado). */
  IDENTITY_NOT_FOUND: "IDENTITY_NOT_FOUND",
  /** El destino existe pero su estado no admite recibir referencias. */
  INVALID_IDENTITY_STATE: "INVALID_IDENTITY_STATE",
  /** El `decisionId` ya existe con otra huella (reuso divergente). */
  DECISION_ID_REUSED_DIVERGENTLY: "DECISION_ID_REUSED_DIVERGENTLY",
} as const;
export type AssociateInvariant = (typeof ASSOCIATE_INVARIANT)[keyof typeof ASSOCIATE_INVARIANT];

/** La referencia asociada y hacia qué handle resuelve (lo que exponen EXECUTED / ALREADY_*). */
export interface AssociatedReference {
  readonly handle: number;
  readonly provider: string;
  readonly externalId: string;
}

/**
 * Resultado de ejecución de Asociar. `ALREADY_SATISFIED` (replay de la MISMA decisión, huella
 * coincidente) y `ALREADY_ASSOCIATED` (la referencia YA resolvía al mismo destino, pero por OTRA
 * decisión) son DISTINTOS a propósito: el primero es idempotencia de decisión; el segundo es un
 * no-op por estado ya satisfecho. Confundirlos borraría la diferencia entre "reintenté lo mismo" y
 * "el mundo ya estaba así por otra vía" (relevante para auditoría y para detectar decisiones redundantes).
 */
export type AssociateResult =
  | { readonly kind: "EXECUTED"; readonly reference: AssociatedReference }
  | { readonly kind: "ALREADY_SATISFIED"; readonly reference: AssociatedReference }
  | { readonly kind: "ALREADY_ASSOCIATED"; readonly reference: AssociatedReference }
  | { readonly kind: "REJECTED"; readonly invariant: AssociateInvariant; readonly message: string };

export const assocExecuted = (reference: AssociatedReference): AssociateResult => ({ kind: "EXECUTED", reference });
export const assocAlreadySatisfied = (reference: AssociatedReference): AssociateResult => ({ kind: "ALREADY_SATISFIED", reference });
export const assocAlreadyAssociated = (reference: AssociatedReference): AssociateResult => ({ kind: "ALREADY_ASSOCIATED", reference });
export const assocRejected = (invariant: AssociateInvariant, message: string): AssociateResult => ({ kind: "REJECTED", invariant, message });

/** Puerto del Registro para Asociar. La infra lo implementa con Prisma. */
export interface AssociateReferenceRegistro {
  associate(decision: AssociateExternalReferenceDecision): Promise<AssociateResult>;
}

/**
 * Adjudicación (costura de juicio): DECIDE qué referencia corresponde a qué Identity y emite la
 * Decisión. NO escribe el namespace, NO reasigna una referencia ocupada, NO resuelve redirecciones,
 * NO sigue mecanismos de persistencia. Estructuralmente solo construye la Decisión (dep. pura).
 */
export function adjudicateAssociateExternalReference(request: AssociateExternalReferenceInput): AssociateExternalReferenceDecision {
  return associateExternalReferenceDecision(request);
}
