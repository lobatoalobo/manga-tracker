/**
 * Dominio de "resolver una propuesta de catálogo" (Community Contributions, ADR-006)
 * — primer slice de resolución final. Prisma-free. Este slice ÚNICAMENTE decide y
 * registra: crea el `ResolutionRecord` (1 por propuesta), marca el outcome de cada
 * claim PROPUESTA y transiciona la propuesta a terminal (ACEPTADA|RECHAZADA) con
 * version++. NO aplica al catálogo (eso será `ApplyCatalogProposal`, slice aparte):
 * no toca Works/Editions/Volumes ni completa los campos applied/mutationCorrelationId.
 *
 * Idempotencia AUTORITATIVA por la unicidad de `ResolutionRecord.proposalId` (una
 * resolución por propuesta); el `idempotencyKey` del comando es solo advisory para
 * mantener consistencia con el contrato de mutations. La huella de replay considera
 * decision + publicReason + privateNote + el set determinista de claimOutcomes.
 * Reusa `IdempotencyConflictError`/`ProposalAlreadyExistsError` de CreateProposal,
 * `ProposalNotFoundError` de RequestProposalInfo y la normalización de RequestInfo.
 */
import { ValidationError } from "@/lib/mutations";
import { IdempotencyConflictError, ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { ProposalNotFoundError, normalizeMessage, normalizePrivateNote, MAX_MESSAGE_LENGTH } from "@/lib/domain/proposal/requestInfo";

export { IdempotencyConflictError, ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
export { ProposalNotFoundError } from "@/lib/domain/proposal/requestInfo";

export const DECISION_ACCEPTED = "ACCEPTED" as const;
export const DECISION_REJECTED = "REJECTED" as const;
export const OUTCOME_ACCEPTED = "ACEPTADA" as const;
export const OUTCOME_REJECTED = "RECHAZADA" as const;

export const CLAIM_RESULT_PROPOSED = "PROPUESTA" as const;
export const CLAIM_RESULT_ACCEPTED = "ACEPTADA" as const;
export const CLAIM_RESULT_NOT_USED = "NO_USADA" as const;

export const ACTOR_TYPE_HUMAN = "HUMAN" as const;
export const PROPOSAL_STATUS_SUBMITTED = "SUBMITTED" as const;
export const INFO_STATUS_OPEN = "ABIERTO" as const;

/** Motivos válidos por resultado (coinciden con el CHECK de ProposalClaim). */
const ACCEPTED_REASONS: ReadonlySet<string> = new Set(["procedencia", "corroboracion"]);
const NOT_USED_REASONS: ReadonlySet<string> = new Set(["desplazada", "descartada", "rechazada"]);

export type ResolveDecision = typeof DECISION_ACCEPTED | typeof DECISION_REJECTED;
export type ResolveOutcomeKind = typeof OUTCOME_ACCEPTED | typeof OUTCOME_REJECTED;
export type ClaimOutcomeResult = typeof CLAIM_RESULT_ACCEPTED | typeof CLAIM_RESULT_NOT_USED;

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
export interface ClaimOutcomeInput {
  claimId: string;
  outcome: ClaimOutcomeResult;
  reason?: string | null;
}

export interface ResolveCatalogProposalCommand {
  proposalId: string;
  decision: ResolveDecision;
  publicReason: string;
  privateNote?: string | null;
  claimOutcomes: ClaimOutcomeInput[];
  idempotencyKey: string;
}

/** Outcome normalizado de un claim, listo para persistir. */
export interface ClaimOutcomeSeed {
  claimId: number;
  result: ClaimOutcomeResult;
  resultReason: string | null;
}

/** Semilla normalizada y validada (shape). La cobertura vs. las claims PROPUESTA de la
 * propuesta se valida en el write-port (necesita las claims bajo lock). */
export interface ResolveSeed {
  proposalId: number;
  outcome: ResolveOutcomeKind;
  publicReason: string;
  privateNote: string | null;
  claimOutcomes: ClaimOutcomeSeed[];
  idempotencyKey: string; // advisory
  moderatorUserId: string; // actor admin
}

export interface ResolveOutcome {
  proposalId: number;
  resolutionRecordId: number;
  proposalStatus: ResolveOutcomeKind;
  recovered: boolean;
}

/** Propuesta bajo lock (para validar estado + transición). */
export interface LockedProposalForResolve {
  id: number;
  status: string;
  version: number;
}

/** ResolutionRecord existente (para idempotencia por proposalId único). */
export interface ExistingResolution {
  id: number;
  outcome: string;
  publicReason: string | null;
  privateNote: string | null;
}

/** Claim de la propuesta (id + estado de resolución) para cobertura + replay. */
export interface ProposalClaimRow {
  id: number;
  result: string;
  resultReason: string | null;
}

/** Estado de resolución (record + claims) para comparación de replay. */
export interface ResolutionState {
  resolution: ExistingResolution;
  claims: ProposalClaimRow[];
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------
export interface ResolveReadPort {
  /** Lectura fuera de tx (recuperación por P2002). */
  loadResolutionState(proposalId: number): Promise<ResolutionState | null>;
}

/**
 * Escritura INDIVISIBLE bajo el lock de la propuesta. La impl (infra) hace:
 * lock → [replay: comparar huella / conflicto] → [nuevo: validar SUBMITTED + sin
 * request abierto → validar cobertura → create ResolutionRecord → resolver claims →
 * transición terminal + version++]. Usa las funciones PURAS de este módulo.
 */
export interface ResolveWritePort {
  resolve(seed: ResolveSeed): Promise<ResolveOutcome>;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------
/** La propuesta no está en un estado resoluble (no SUBMITTED / request abierto). */
export class ProposalNotResolvableError extends Error {
  readonly code = "PROPOSAL_NOT_RESOLVABLE" as const;
  constructor(readonly status: string) {
    super(`La propuesta no admite resolución (estado ${status}).`);
    this.name = "ProposalNotResolvableError";
  }
}

/** Los claimOutcomes son inválidos (cobertura, duplicados, claim ajena, coherencia). */
export class ClaimOutcomesInvalidError extends Error {
  readonly code = "CLAIM_OUTCOMES_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "ClaimOutcomesInvalidError";
  }
}

// ---------------------------------------------------------------------------
// Normalización + validación (shape)
// ---------------------------------------------------------------------------
function normalizeReason(outcome: ClaimOutcomeResult, reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const n = normalizeMessage(reason);
  if (n.length === 0) return null;
  const allowed = outcome === CLAIM_RESULT_ACCEPTED ? ACCEPTED_REASONS : NOT_USED_REASONS;
  if (!allowed.has(n))
    throw new ClaimOutcomesInvalidError(`El motivo "${n}" no es válido para un claim ${outcome}.`);
  return n;
}

/**
 * Normaliza + valida el comando y arma la semilla. `ValidationError` para el shape
 * general; `ClaimOutcomesInvalidError` para lo específico de claimOutcomes (outcome,
 * coherencia motivo/outcome, duplicados, y REJECTED ⇒ todos NO_USADA). La COBERTURA
 * (todo claim PROPUESTA de la propuesta cubierto) se valida en el write-port.
 */
export function buildResolveSeed(
  command: ResolveCatalogProposalCommand,
  moderatorUserId: string,
): ResolveSeed {
  if (!command.idempotencyKey || !command.idempotencyKey.trim())
    throw new ValidationError("Falta idempotencyKey.");

  const proposalId = Number(command.proposalId);
  if (!Number.isInteger(proposalId) || proposalId <= 0)
    throw new ValidationError("proposalId inválido.");

  if (command.decision !== DECISION_ACCEPTED && command.decision !== DECISION_REJECTED)
    throw new ValidationError("decision inválida (ACCEPTED|REJECTED).");
  const outcome: ResolveOutcomeKind =
    command.decision === DECISION_ACCEPTED ? OUTCOME_ACCEPTED : OUTCOME_REJECTED;

  const publicReason = normalizeMessage(command.publicReason ?? "");
  if (publicReason.length < 1)
    throw new ValidationError("El motivo público no puede estar vacío.");
  if (publicReason.length > MAX_MESSAGE_LENGTH)
    throw new ValidationError(`El motivo público supera ${MAX_MESSAGE_LENGTH} caracteres.`);

  const privateNote = normalizePrivateNote(command.privateNote);
  if (privateNote !== null && privateNote.length > MAX_MESSAGE_LENGTH)
    throw new ValidationError(`La nota privada supera ${MAX_MESSAGE_LENGTH} caracteres.`);

  if (!Array.isArray(command.claimOutcomes))
    throw new ClaimOutcomesInvalidError("claimOutcomes debe ser una lista.");

  const seen = new Set<number>();
  const claimOutcomes: ClaimOutcomeSeed[] = command.claimOutcomes.map((o) => {
    const claimId = Number(o.claimId);
    if (!Number.isInteger(claimId) || claimId <= 0)
      throw new ClaimOutcomesInvalidError("claimId inválido en claimOutcomes.");
    if (seen.has(claimId))
      throw new ClaimOutcomesInvalidError(`claim ${claimId} duplicada en claimOutcomes.`);
    seen.add(claimId);
    if (o.outcome !== CLAIM_RESULT_ACCEPTED && o.outcome !== CLAIM_RESULT_NOT_USED)
      throw new ClaimOutcomesInvalidError(`outcome inválido para claim ${claimId} (ACEPTADA|NO_USADA).`);
    // REJECTED ⇒ toda claim termina NO_USADA.
    if (outcome === OUTCOME_REJECTED && o.outcome !== CLAIM_RESULT_NOT_USED)
      throw new ClaimOutcomesInvalidError(
        `Una propuesta RECHAZADA no puede aceptar claims (claim ${claimId}).`,
      );
    return { claimId, result: o.outcome, resultReason: normalizeReason(o.outcome, o.reason) };
  });

  return { proposalId, outcome, publicReason, privateNote, claimOutcomes, idempotencyKey: command.idempotencyKey, moderatorUserId };
}

// ---------------------------------------------------------------------------
// Cobertura de claims (necesita las claims de la propuesta, bajo lock)
// ---------------------------------------------------------------------------
/**
 * Toda claim PROPUESTA de la propuesta debe estar cubierta exactamente una vez, y
 * cada claimId del comando debe ser una claim PROPUESTA de la propuesta. Las claims ya
 * terminales (ACEPTADA/NO_USADA/RETIRADA) NO se resuelven ni deben aparecer.
 */
export function assertClaimCoverage(
  seedOutcomes: ClaimOutcomeSeed[],
  proposalClaims: ProposalClaimRow[],
): void {
  const proposedIds = new Set(
    proposalClaims.filter((c) => c.result === CLAIM_RESULT_PROPOSED).map((c) => c.id),
  );
  const seen = new Set<number>();
  for (const o of seedOutcomes) {
    if (seen.has(o.claimId))
      throw new ClaimOutcomesInvalidError(`claim ${o.claimId} duplicada en claimOutcomes.`);
    seen.add(o.claimId);
    if (!proposedIds.has(o.claimId))
      throw new ClaimOutcomesInvalidError(`La claim ${o.claimId} no pertenece a la propuesta o no está PROPUESTA.`);
  }
  for (const id of proposedIds)
    if (!seen.has(id))
      throw new ClaimOutcomesInvalidError("Cobertura incompleta: falta resolver alguna claim PROPUESTA.");
}

// ---------------------------------------------------------------------------
// Idempotencia — huella (decision + reasons + set determinista de claimOutcomes)
// ---------------------------------------------------------------------------
function claimsKey(
  outcomes: ReadonlyArray<{ claimId: number; result: string; resultReason: string | null }>,
): string {
  return [...outcomes]
    .sort((a, b) => a.claimId - b.claimId)
    .map((o) => `${o.claimId}:${o.result}:${o.resultReason ?? ""}`)
    .join("|");
}

export interface ResolveFingerprint {
  outcome: string;
  publicReason: string | null;
  privateNote: string | null;
  claimsKey: string;
}

export function fingerprintOfSeed(seed: ResolveSeed): ResolveFingerprint {
  return {
    outcome: seed.outcome,
    publicReason: seed.publicReason,
    privateNote: seed.privateNote,
    claimsKey: claimsKey(seed.claimOutcomes),
  };
}

/**
 * Huella del estado ya persistido: el outcome/motivos del ResolutionRecord y, para los
 * mismos claimIds que trae la semilla, el result/resultReason PERSISTIDO de cada claim
 * (una claim ausente cuenta como "MISSING" → nunca coincide).
 */
export function fingerprintOfExisting(
  resolution: ExistingResolution,
  seedOutcomes: ClaimOutcomeSeed[],
  persistedClaims: ProposalClaimRow[],
): ResolveFingerprint {
  const byId = new Map(persistedClaims.map((c) => [c.id, c]));
  const claims = seedOutcomes.map((o) => {
    const p = byId.get(o.claimId);
    return { claimId: o.claimId, result: p ? p.result : "MISSING", resultReason: p ? p.resultReason : null };
  });
  return {
    outcome: resolution.outcome,
    publicReason: resolution.publicReason,
    privateNote: resolution.privateNote,
    claimsKey: claimsKey(claims),
  };
}

export function sameResolveFingerprint(a: ResolveFingerprint, b: ResolveFingerprint): boolean {
  return (
    a.outcome === b.outcome &&
    a.publicReason === b.publicReason &&
    a.privateNote === b.privateNote &&
    a.claimsKey === b.claimsKey
  );
}

/** Replay: misma huella → compatible (recuperar); distinta → `IdempotencyConflictError`. */
export function assertCompatibleResolveReplay(
  seed: ResolveSeed,
  resolution: ExistingResolution,
  persistedClaims: ProposalClaimRow[],
): void {
  if (
    !sameResolveFingerprint(
      fingerprintOfSeed(seed),
      fingerprintOfExisting(resolution, seed.claimOutcomes, persistedClaims),
    )
  )
    throw new IdempotencyConflictError(
      "La propuesta ya fue resuelta de una forma distinta.",
    );
}
