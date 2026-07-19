/**
 * Dominio del caso de uso "solicitar información sobre una propuesta"
 * (Community Contributions, ADR-006) — primer paso de moderación. Prisma-free.
 * Primer corte: scope PROPOSAL, dirigido al originador (targetUserId=null), una sola
 * solicitud ABIERTO por propuesta, transición SUBMITTED→NEEDS_INFO. Idempotencia
 * fuerte por `ProposalInfoRequest.idempotencyKey`; el payload autoritativo incluye
 * `privateNote`. Reusa `IdempotencyConflictError` del slice CreateProposal.
 */
import { ValidationError } from "@/lib/mutations";
import { IdempotencyConflictError } from "@/lib/domain/proposal/create";

export { IdempotencyConflictError } from "@/lib/domain/proposal/create";

export const INFO_SCOPE_PROPOSAL = "PROPOSAL" as const;
export const INFO_STATUS_OPEN = "ABIERTO" as const;
export const PROPOSAL_STATUS_SUBMITTED = "SUBMITTED" as const;
export const PROPOSAL_STATUS_NEEDS_INFO = "NEEDS_INFO" as const;
export const MAX_MESSAGE_LENGTH = 2000;

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "ACEPTADA", "RECHAZADA", "SUPERSEDED", "ABANDONADA",
]);

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
export interface RequestProposalInfoCommand {
  proposalId: string;
  publicMessage: string;
  privateNote?: string | null;
  idempotencyKey: string;
}

/** Semilla normalizada y validada, lista para persistir. */
export interface RequestInfoSeed {
  proposalId: number;
  prompt: string; // publicMessage normalizado
  privateNote: string | null; // normalizado; "" → null
  idempotencyKey: string;
  openedByUserId: string; // actor (moderador)
}

export interface ExistingInfoRequest {
  infoRequestId: number;
  proposalId: number;
  scope: string;
  targetUserId: string | null;
  targetContributionId: number | null;
  prompt: string;
  privateNote: string | null;
}

export interface LockedProposal {
  id: number;
  status: string;
  version: number;
}

/** Resultado de dominio de la operación (creada o recuperada). */
export interface RequestInfoOutcome {
  proposalId: number;
  infoRequestId: number;
  proposalStatus: string;
  recovered: boolean;
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------
export interface RequestInfoReadPort {
  /** Lectura fuera de tx (recuperación por P2002). */
  findByIdempotencyKey(key: string): Promise<ExistingInfoRequest | null>;
}

/**
 * Puerto de escritura: una operación INDIVISIBLE bajo el lock de la propuesta.
 * La impl (infra) hace lock → lookup(key) → [replay: comparar payload / conflicto] →
 * [nuevo: validar estado + no-open → create + transición] y captura el resultado.
 * Usa las funciones PURAS de este módulo para las decisiones.
 */
export interface RequestInfoWritePort {
  requestInfo(seed: RequestInfoSeed): Promise<RequestInfoOutcome>;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------
export class ProposalNotRequestableError extends Error {
  readonly code = "PROPOSAL_NOT_REQUESTABLE" as const;
  constructor(readonly status: string) {
    super(`La propuesta no admite solicitar información (estado ${status}).`);
    this.name = "ProposalNotRequestableError";
  }
}

export class OpenRequestExistsError extends Error {
  readonly code = "OPEN_REQUEST_EXISTS" as const;
  constructor() {
    super("La propuesta ya tiene una solicitud de información abierta.");
    this.name = "OpenRequestExistsError";
  }
}

/** La propuesta no existe. La action lo mapea a una respuesta genérica (anti-enum). */
export class ProposalNotFoundError extends Error {
  readonly code = "PROPOSAL_NOT_FOUND" as const;
  constructor() {
    super("La propuesta no existe.");
    this.name = "ProposalNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Normalización + validación
// ---------------------------------------------------------------------------
/** Colapsa whitespace interno a un espacio y recorta. Determinista. */
export function normalizeMessage(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Igual que normalizeMessage; ausencia / vacío → null. */
export function normalizePrivateNote(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const n = normalizeMessage(s);
  return n.length === 0 ? null : n;
}

/**
 * Normaliza + valida el comando y arma la semilla. Lanza `ValidationError`.
 * `proposalId` llega como string (contrato externo) y se parsea a Int.
 */
export function buildRequestInfoSeed(
  command: RequestProposalInfoCommand,
  openedByUserId: string,
): RequestInfoSeed {
  if (!command.idempotencyKey || !command.idempotencyKey.trim())
    throw new ValidationError("Falta idempotencyKey.");

  const proposalId = Number(command.proposalId);
  if (!Number.isInteger(proposalId) || proposalId <= 0)
    throw new ValidationError("proposalId inválido.");

  const prompt = normalizeMessage(command.publicMessage ?? "");
  if (prompt.length < 1)
    throw new ValidationError("El mensaje público no puede estar vacío.");
  if (prompt.length > MAX_MESSAGE_LENGTH)
    throw new ValidationError(`El mensaje público supera ${MAX_MESSAGE_LENGTH} caracteres.`);

  const privateNote = normalizePrivateNote(command.privateNote);
  if (privateNote !== null && privateNote.length > MAX_MESSAGE_LENGTH)
    throw new ValidationError(`La nota privada supera ${MAX_MESSAGE_LENGTH} caracteres.`);

  return { proposalId, prompt, privateNote, idempotencyKey: command.idempotencyKey, openedByUserId };
}

// ---------------------------------------------------------------------------
// Transición de estado
// ---------------------------------------------------------------------------
/**
 * Valida que la propuesta pueda recibir una solicitud NUEVA (tras confirmar que no
 * hay replay por key). Solo desde SUBMITTED. Terminal → `ProposalNotRequestableError`;
 * NEEDS_INFO → `OpenRequestExistsError` (ya hay una abierta con otra key).
 */
export function assertRequestableForNew(status: string): void {
  if (status === PROPOSAL_STATUS_SUBMITTED) return;
  if (TERMINAL_STATUSES.has(status)) throw new ProposalNotRequestableError(status);
  throw new OpenRequestExistsError();
}

// ---------------------------------------------------------------------------
// Idempotencia — huella (incluye privateNote)
// ---------------------------------------------------------------------------
export interface InfoFingerprint {
  proposalId: number;
  scope: string;
  targetUserId: string | null;
  targetContributionId: number | null;
  prompt: string;
  privateNote: string | null;
}

export function fingerprintOfSeed(s: RequestInfoSeed): InfoFingerprint {
  return {
    proposalId: s.proposalId,
    scope: INFO_SCOPE_PROPOSAL,
    targetUserId: null,
    targetContributionId: null,
    prompt: s.prompt,
    privateNote: s.privateNote,
  };
}

export function fingerprintOfExisting(e: ExistingInfoRequest): InfoFingerprint {
  return {
    proposalId: e.proposalId,
    scope: e.scope,
    targetUserId: e.targetUserId,
    targetContributionId: e.targetContributionId,
    prompt: e.prompt,
    privateNote: e.privateNote,
  };
}

export function sameInfoFingerprint(a: InfoFingerprint, b: InfoFingerprint): boolean {
  return (
    a.proposalId === b.proposalId &&
    a.scope === b.scope &&
    a.targetUserId === b.targetUserId &&
    a.targetContributionId === b.targetContributionId &&
    a.prompt === b.prompt &&
    a.privateNote === b.privateNote
  );
}

/**
 * Replay: si la key ya existe, misma huella (incluye proposalId + privateNote) →
 * compatible (recuperar); distinta → `IdempotencyConflictError`.
 */
export function assertCompatibleInfoReplay(
  seed: RequestInfoSeed,
  existing: ExistingInfoRequest,
): void {
  if (!sameInfoFingerprint(fingerprintOfSeed(seed), fingerprintOfExisting(existing)))
    throw new IdempotencyConflictError(
      "La clave de idempotencia ya se usó para otra solicitud de información distinta.",
    );
}
