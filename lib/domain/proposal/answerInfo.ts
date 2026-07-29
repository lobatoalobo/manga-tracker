/**
 * Dominio de "responder una solicitud de información" (Community Contributions,
 * ADR-006). Prisma-free. El originador responde un InfoRequest ABIERTO con una nueva
 * ProposalContribution (append-only) + claims, cerrando el request (ANSWERED) y
 * devolviendo la propuesta a SUBMITTED cuando no queda ningún request abierto.
 * REUTILIZA la validación/normalización de claims de AddProposalContribution (no la
 * duplica). Idempotencia autoritativa por `ProposalContribution.idempotencyKey`; la
 * huella agrega `answersInfoRequestId` (+ proposalId + authorId) al set de claims.
 */
import { ValidationError } from "@/lib/mutations";
import { IdempotencyConflictError } from "@/lib/domain/proposal/create";
import {
  ATTRIBUTE_KIND_LEVEL,
  allowedLevelsForTarget,
  claimSetFingerprint,
  normalizeClaims,
  validateInputShape,
  type ClaimInput,
  type ClaimSeed,
  type PersistedClaim,
} from "@/lib/domain/proposal/addContribution";

export { IdempotencyConflictError } from "@/lib/domain/proposal/create";

export const PROPOSAL_STATUS_NEEDS_INFO = "NEEDS_INFO" as const;
export const PROPOSAL_STATUS_SUBMITTED = "SUBMITTED" as const;
export const INFO_STATUS_OPEN = "ABIERTO" as const;
export const INFO_STATUS_ANSWERED = "ANSWERED" as const;
export const INFO_SCOPE_PROPOSAL = "PROPOSAL" as const;
export const ANSWER_VISIBILITY = "VISIBLE" as const;

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
export interface AnswerProposalInfoRequestCommand {
  proposalId: string;
  infoRequestId: string;
  claims: ClaimInput[];
  idempotencyKey: string;
}

export interface AnswerSeed {
  proposalId: number;
  infoRequestId: number;
  claims: ClaimSeed[];
  idempotencyKey: string;
  authorId: string; // el originador (actor)
}

export interface AnswerOutcome {
  proposalId: number;
  contributionId: number;
  infoRequestId: number;
  proposalStatus: string;
  recovered: boolean;
}

/** Propuesta bajo lock (para autorización + nivel + transición). */
export interface LockedProposalForAnswer {
  id: number;
  status: string;
  originatorUserId: string | null;
  targetKind: string;
  version: number;
}

/** InfoRequest objetivo (identificado explícitamente por el comando). */
export interface InfoRequestForAnswer {
  id: number;
  proposalId: number;
  scope: string;
  targetUserId: string | null;
  targetContributionId: number | null;
  status: string;
}

/** Contribución existente (para idempotencia por idempotencyKey). */
export interface ExistingAnswerContribution {
  id: number;
  proposalId: number;
  authorId: string | null;
  answersInfoRequestId: number | null;
  claims: PersistedClaim[];
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------
export interface AnswerReadPort {
  findContributionByIdempotencyKey(key: string): Promise<ExistingAnswerContribution | null>;
}

/** Escritura indivisible bajo el lock de la propuesta (impl en infra). */
export interface AnswerWritePort {
  answer(seed: AnswerSeed): Promise<AnswerOutcome>;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------
/** El actor no es el originador de la propuesta. La action lo mapea a genérico. */
export class NotProposalOriginatorError extends Error {
  readonly code = "NOT_PROPOSAL_ORIGINATOR" as const;
  constructor() {
    super("No autorizado a responder esta propuesta.");
    this.name = "NotProposalOriginatorError";
  }
}

/** El InfoRequest no es respondible (no existe / no pertenece / scope / cerrado). */
export class InfoRequestNotAnswerableError extends Error {
  readonly code = "INFO_REQUEST_NOT_ANSWERABLE" as const;
  constructor() {
    super("La solicitud de información no está abierta para responder.");
    this.name = "InfoRequestNotAnswerableError";
  }
}

// ---------------------------------------------------------------------------
// Validación (reutiliza AddContribution) + normalización
// ---------------------------------------------------------------------------
/**
 * Normaliza + valida el comando. Reutiliza `validateInputShape` de AddContribution
 * para la validación de claims (mismas reglas: ≥1, enums, coherencia op↔value,
 * attributeKind ∈ catálogo). El nivel vs. targetKind se valida en el write-port
 * (necesita la propuesta bajo lock).
 */
export function buildAnswerSeed(
  command: AnswerProposalInfoRequestCommand,
  actorUserId: string,
): AnswerSeed {
  if (!command.idempotencyKey || !command.idempotencyKey.trim())
    throw new ValidationError("Falta idempotencyKey.");
  const proposalId = Number(command.proposalId);
  if (!Number.isInteger(proposalId) || proposalId <= 0)
    throw new ValidationError("proposalId inválido.");
  const infoRequestId = Number(command.infoRequestId);
  if (!Number.isInteger(infoRequestId) || infoRequestId <= 0)
    throw new ValidationError("infoRequestId inválido.");

  // Reutiliza EXACTAMENTE la validación de claims de AddContribution.
  validateInputShape({ proposalId, createIdempotencyKey: command.idempotencyKey, claims: command.claims });

  return {
    proposalId,
    infoRequestId,
    claims: normalizeClaims(command.claims),
    idempotencyKey: command.idempotencyKey,
    authorId: actorUserId,
  };
}

/** Nivel de cada claim compatible con el targetKind de la propuesta. */
export function assertClaimsLevelForTarget(claims: ClaimSeed[], targetKind: string): void {
  const allowed = allowedLevelsForTarget(targetKind);
  for (const c of claims) {
    const level = ATTRIBUTE_KIND_LEVEL[c.attributeKind];
    if (!allowed.has(level))
      throw new ValidationError(
        `El atributo ${c.attributeKind} (nivel ${level}) no aplica a una propuesta ${targetKind}.`,
      );
  }
}

/** Elegibilidad del InfoRequest: pertenece + scope PROPOSAL + al originador + ABIERTO. */
export function assertRequestAnswerable(
  req: InfoRequestForAnswer | null,
  proposalId: number,
): asserts req is InfoRequestForAnswer {
  if (
    !req ||
    req.proposalId !== proposalId ||
    req.scope !== INFO_SCOPE_PROPOSAL ||
    req.targetUserId !== null ||
    req.targetContributionId !== null ||
    req.status !== INFO_STATUS_OPEN
  )
    throw new InfoRequestNotAnswerableError();
}

// ---------------------------------------------------------------------------
// Idempotencia — huella (claims + answersInfoRequestId + proposalId + authorId)
// ---------------------------------------------------------------------------
export interface AnswerFingerprint {
  proposalId: number;
  answersInfoRequestId: number | null;
  authorId: string | null;
  claimsKey: string;
}

export function fingerprintOfSeed(s: AnswerSeed): AnswerFingerprint {
  return {
    proposalId: s.proposalId,
    answersInfoRequestId: s.infoRequestId,
    authorId: s.authorId,
    claimsKey: claimSetFingerprint(s.claims),
  };
}

export function fingerprintOfExisting(e: ExistingAnswerContribution): AnswerFingerprint {
  return {
    proposalId: e.proposalId,
    answersInfoRequestId: e.answersInfoRequestId,
    authorId: e.authorId,
    claimsKey: claimSetFingerprint(e.claims),
  };
}

export function sameAnswerFingerprint(a: AnswerFingerprint, b: AnswerFingerprint): boolean {
  return (
    a.proposalId === b.proposalId &&
    a.answersInfoRequestId === b.answersInfoRequestId &&
    a.authorId === b.authorId &&
    a.claimsKey === b.claimsKey
  );
}

/** Replay: misma huella → compatible (recuperar); distinta → conflicto. */
export function assertCompatibleAnswerReplay(
  seed: AnswerSeed,
  existing: ExistingAnswerContribution,
): void {
  if (!sameAnswerFingerprint(fingerprintOfSeed(seed), fingerprintOfExisting(existing)))
    throw new IdempotencyConflictError(
      "La clave de idempotencia ya se usó para otra respuesta distinta.",
    );
}
