/**
 * Dominio del caso de uso "agregar contribución a una propuesta" (Community
 * Contributions, ADR-006). Prisma-free. Una contribución es append-only y se crea
 * con ≥1 claim (inmutables, nacen PROPUESTA): no existe "agregar claim a una
 * contribución existente". Este slice valida SOLO lo estructural mínimo; la
 * validación profunda del `value` por `(attributeKind, contractVersion)`, evidencias,
 * resolución y recomputes quedan fuera. Reusa tipos/errores del slice CreateProposal.
 */
import { ValidationError } from "@/lib/mutations";
import type { ProposalTargetKind } from "@/lib/domain/proposal/create";

export type ClaimOperation =
  | "SET"
  | "ADD"
  | "REMOVE"
  | "MARK_UNKNOWN"
  | "MARK_NOT_APPLICABLE";

/** Las claims nuevas siempre nacen con este resultado (sin resultReason). */
export const CLAIM_INITIAL_RESULT = "PROPUESTA" as const;

const MARK_OPERATIONS: ReadonlySet<ClaimOperation> = new Set([
  "MARK_UNKNOWN",
  "MARK_NOT_APPLICABLE",
]);
const CLAIM_OPERATIONS: ReadonlySet<string> = new Set<ClaimOperation>([
  "SET", "ADD", "REMOVE", "MARK_UNKNOWN", "MARK_NOT_APPLICABLE",
]);

/** Tope de claims por contribución (anti-abuso; la forma fina se difiere). */
export const MAX_CLAIMS_PER_CONTRIBUTION = 50;

// ---------------------------------------------------------------------------
// Catálogo mínimo de attributeKind → nivel (de docs/community-contributions-
// attribute-kinds.md §A/§B). La forma del `value` NO se valida en este slice.
// ---------------------------------------------------------------------------
export type AttributeLevel = "WORK" | "EDITION" | "VOLUME";

export const ATTRIBUTE_KIND_LEVEL: Readonly<Record<string, AttributeLevel>> = {
  // Work
  TITLE_LOCALIZED: "WORK", TITLE_NATIVE: "WORK", TITLE_ROMAJI: "WORK",
  TITLE_ALTERNATIVE: "WORK", WORK_TYPE: "WORK", ORIGINAL_LANGUAGE: "WORK",
  COUNTRY_OF_ORIGIN: "WORK", WORK_STATUS: "WORK", START_DATE: "WORK",
  END_DATE: "WORK", SYNOPSIS_LOCALIZED: "WORK", CREATOR_CREDIT: "WORK",
  EXTERNAL_WORK_ID: "WORK",
  // Edition
  EDITION_PUBLISHER: "EDITION", EDITION_COUNTRY: "EDITION", EDITION_LANGUAGE: "EDITION",
  EDITION_FORMAT: "EDITION", EDITION_LABEL_OR_IMPRINT: "EDITION", EDITION_STATUS: "EDITION",
  EDITION_RELEASE_DATE: "EDITION", EDITION_ANNOUNCED_TOTAL_VOLUMES: "EDITION",
  EDITION_IS_UPCOMING: "EDITION", EXTERNAL_EDITION_ID: "EDITION",
  // Volume
  VOLUME_NUMBER: "VOLUME", VOLUME_TITLE: "VOLUME", VOLUME_RELEASE_DATE: "VOLUME",
  VOLUME_ISBN: "VOLUME", VOLUME_PAGE_COUNT: "VOLUME", VOLUME_COVER: "VOLUME",
  VOLUME_STATUS: "VOLUME", EXTERNAL_VOLUME_ID: "VOLUME",
};

/**
 * Niveles de claim admitidos por targetKind (matriz §D, versión mínima). Se DIFIERE
 * la excepción "Alta-Work admite además el set mínimo de primera Edición"; acá un
 * Alta/Corrección de Work solo admite Work-kinds. STRUCTURAL no admite claims
 * descriptivas (los reportes usan relación + evidencia, fuera de este slice).
 */
export function allowedLevelsForTarget(targetKind: string): ReadonlySet<AttributeLevel> {
  switch (targetKind) {
    case "NEW_WORK":
    case "WORK":
      return new Set(["WORK"]);
    case "NEW_EDITION":
    case "EDITION":
      return new Set(["EDITION"]);
    case "NEW_VOLUME":
    case "VOLUME":
      return new Set(["VOLUME"]);
    default: // STRUCTURAL u otros: sin claims descriptivas
      return new Set();
  }
}

// Estados no terminales que aceptan contribuciones.
const OPEN_STATUSES: ReadonlySet<string> = new Set(["SUBMITTED", "NEEDS_INFO"]);

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
export interface ClaimInput {
  attributeKind: string;
  contractVersion: number;
  claimOperation: ClaimOperation;
  value?: unknown | null;
}

export interface AddProposalContributionInput {
  proposalId: number;
  createIdempotencyKey: string;
  claims: ClaimInput[];
}

/** Claim normalizada, lista para insertar (value=null si MARK_*). */
export interface ClaimSeed {
  attributeKind: string;
  contractVersion: number;
  claimOperation: ClaimOperation;
  value: unknown | null;
}

export interface AddContributionSeed {
  proposalId: number;
  idempotencyKey: string;
  authorId: string;
  claims: ClaimSeed[];
}

/** Proyección de la propuesta objetivo (para validar apertura y nivel). */
export interface ProposalForContribution {
  id: number;
  status: string;
  contentClass: string;
  targetKind: string;
  family: string;
}

/** Claim persistida (para comparar en idempotencia). */
export interface PersistedClaim {
  attributeKind: string;
  contractVersion: number;
  claimOperation: string;
  value: unknown | null;
}

/** Contribución existente (para idempotencia por idempotencyKey). */
export interface ExistingContribution {
  id: number;
  proposalId: number;
  claims: PersistedClaim[];
}

// Puertos
export interface AddContributionReadPort {
  loadProposalForContribution(proposalId: number): Promise<ProposalForContribution | null>;
  findContributionByIdempotencyKey(key: string): Promise<ExistingContribution | null>;
}
export interface AddContributionWritePort {
  insertContributionWithClaims(
    seed: AddContributionSeed,
  ): Promise<{ proposalId: number; contributionId: number }>;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------
/** La propuesta está en un estado terminal y no acepta nuevas contribuciones. */
export class ProposalNotOpenError extends Error {
  readonly code = "PROPOSAL_NOT_OPEN" as const;
  constructor(readonly status: string) {
    super(`La propuesta está cerrada a nuevas contribuciones (estado ${status}).`);
    this.name = "ProposalNotOpenError";
  }
}

// ---------------------------------------------------------------------------
// Validación estructural (pura, sin I/O) + normalización
// ---------------------------------------------------------------------------
const isPresent = (v: unknown): boolean => v !== null && v !== undefined;

/** Chequeos baratos sin I/O: proposalId/key, ≥1 claim, enums, coherencia op↔value. */
export function validateInputShape(input: AddProposalContributionInput): void {
  if (!Number.isInteger(input.proposalId) || input.proposalId <= 0)
    throw new ValidationError("proposalId inválido.");
  if (!input.createIdempotencyKey || !input.createIdempotencyKey.trim())
    throw new ValidationError("Falta createIdempotencyKey.");
  if (!Array.isArray(input.claims) || input.claims.length < 1)
    throw new ValidationError("La contribución requiere al menos un claim.");
  if (input.claims.length > MAX_CLAIMS_PER_CONTRIBUTION)
    throw new ValidationError(
      `Demasiados claims (máx ${MAX_CLAIMS_PER_CONTRIBUTION}).`,
    );

  for (const c of input.claims) {
    if (!c.attributeKind || !(c.attributeKind in ATTRIBUTE_KIND_LEVEL))
      throw new ValidationError(`attributeKind desconocido: ${c.attributeKind}.`);
    if (!Number.isInteger(c.contractVersion))
      throw new ValidationError(`contractVersion inválido en ${c.attributeKind}.`);
    if (!CLAIM_OPERATIONS.has(c.claimOperation))
      throw new ValidationError(`claimOperation inválido: ${c.claimOperation}.`);
    const isMark = MARK_OPERATIONS.has(c.claimOperation);
    if (isMark && isPresent(c.value))
      throw new ValidationError(
        `${c.claimOperation} no admite value (${c.attributeKind}).`,
      );
    if (!isMark && !isPresent(c.value))
      throw new ValidationError(
        `${c.claimOperation} requiere value (${c.attributeKind}).`,
      );
  }
}

/** Normaliza claims para persistir/comparar: value=null si MARK_* o ausente. */
export function normalizeClaims(claims: ClaimInput[]): ClaimSeed[] {
  return claims.map((c) => ({
    attributeKind: c.attributeKind,
    contractVersion: c.contractVersion,
    claimOperation: c.claimOperation,
    value: isPresent(c.value) && !MARK_OPERATIONS.has(c.claimOperation) ? c.value! : null,
  }));
}

/**
 * Valida apertura de la propuesta + compatibilidad de nivel de cada claim, y arma
 * la semilla. Lanza `ProposalNotOpenError` si la propuesta es terminal.
 */
export async function buildContributionSeed(
  read: AddContributionReadPort,
  input: AddProposalContributionInput,
  authorId: string,
): Promise<AddContributionSeed> {
  validateInputShape(input);
  const proposal = await read.loadProposalForContribution(input.proposalId);
  if (!proposal) throw new ValidationError("La propuesta no existe.");
  if (!OPEN_STATUSES.has(proposal.status))
    throw new ProposalNotOpenError(proposal.status);
  if (proposal.contentClass !== "MANGA" && proposal.contentClass !== "COMIC")
    throw new ValidationError("La propuesta tiene un contentClass inválido.");

  const allowed = allowedLevelsForTarget(proposal.targetKind);
  for (const c of input.claims) {
    const level = ATTRIBUTE_KIND_LEVEL[c.attributeKind];
    if (!allowed.has(level))
      throw new ValidationError(
        `El atributo ${c.attributeKind} (nivel ${level}) no aplica a una propuesta ${proposal.targetKind}.`,
      );
  }

  return {
    proposalId: proposal.id,
    idempotencyKey: input.createIdempotencyKey,
    authorId,
    claims: normalizeClaims(input.claims),
  };
}

// ---------------------------------------------------------------------------
// Idempotencia — huella del conjunto de claims (normalizado, orden-insensible)
// ---------------------------------------------------------------------------
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

const claimKey = (c: PersistedClaim): string =>
  [c.attributeKind, c.contractVersion, c.claimOperation, stableStringify(c.value ?? null)].join(" ");

/** Huella determinística del set de claims (independiente del orden). */
export function claimSetFingerprint(claims: PersistedClaim[]): string {
  return claims.map(claimKey).sort().join("");
}

export function sameClaimSet(a: PersistedClaim[], b: PersistedClaim[]): boolean {
  return claimSetFingerprint(a) === claimSetFingerprint(b);
}
