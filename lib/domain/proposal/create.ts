/**
 * Dominio del caso de uso "crear propuesta de catálogo" (Community Contributions,
 * ADR-006). Prisma-free: la validación estructural, la derivación de `contentClass`
 * y la huella de idempotencia viven acá; los datos entran por PUERTOS que la infra
 * implementa con Prisma. Espeja los CHECK constraints de la migración
 * `20260717000000_add_community_contributions_checks` para producir errores claros
 * ANTES de tocar la DB (los CHECK quedan de backstop).
 */
import { ValidationError } from "@/lib/mutations";

export type ProposalFamily = "ALTA" | "CORRECCION" | "REPORTE";
export type ProposalTargetKind =
  | "NEW_WORK"
  | "NEW_EDITION"
  | "NEW_VOLUME"
  | "WORK"
  | "EDITION"
  | "VOLUME"
  | "STRUCTURAL";
export type ContentClass = "MANGA" | "COMIC";
export type RelationKind = "DUPLICATE" | "BAD_MERGE";
export type CatalogProposalStatus =
  | "SUBMITTED"
  | "NEEDS_INFO"
  | "ACEPTADA"
  | "RECHAZADA"
  | "SUPERSEDED"
  | "ABANDONADA";

export const PROPOSAL_INITIAL_STATUS: CatalogProposalStatus = "SUBMITTED";

const FAMILIES: readonly ProposalFamily[] = ["ALTA", "CORRECCION", "REPORTE"];
const TARGET_KINDS: readonly ProposalTargetKind[] = [
  "NEW_WORK", "NEW_EDITION", "NEW_VOLUME", "WORK", "EDITION", "VOLUME", "STRUCTURAL",
];
const CONTENT_CLASSES: readonly ContentClass[] = ["MANGA", "COMIC"];
const RELATION_KINDS: readonly RelationKind[] = ["DUPLICATE", "BAD_MERGE"];

/** Qué targetKind admite cada familia (espeja `family_targetKind_check`). */
const FAMILY_TARGETS: Record<ProposalFamily, readonly ProposalTargetKind[]> = {
  ALTA: ["NEW_WORK", "NEW_EDITION", "NEW_VOLUME"],
  CORRECCION: ["WORK", "EDITION", "VOLUME"],
  REPORTE: ["STRUCTURAL"],
};

/**
 * Payload público (el usuario NO viaja acá: se toma de `requireUserId()`).
 * `contentClass` solo lo define el cliente para `NEW_WORK` (no hay entidad de la
 * cual derivarlo); en el resto se deriva del catálogo referenciado.
 */
export interface CreateCatalogProposalInput {
  createIdempotencyKey: string;
  family: ProposalFamily;
  targetKind: ProposalTargetKind;
  refWorkId?: number | null;
  refEditionId?: number | null;
  refVolumeId?: number | null;
  refWorkBId?: number | null;
  relationKind?: RelationKind | null;
  contentClass?: ContentClass | null;
}

/** Semilla normalizada y validada, lista para insertar. */
export interface CatalogProposalSeed {
  family: ProposalFamily;
  targetKind: ProposalTargetKind;
  contentClass: ContentClass;
  refWorkId: number | null;
  refEditionId: number | null;
  refVolumeId: number | null;
  refWorkBId: number | null;
  relationKind: RelationKind | null;
  createIdempotencyKey: string;
  originatorUserId: string;
}

/** Proyección de una propuesta ya existente (para idempotencia). */
export interface ExistingProposal {
  id: number;
  status: string;
  originatingContributionId: number | null;
  family: string;
  targetKind: string;
  contentClass: string;
  refWorkId: number | null;
  refEditionId: number | null;
  refVolumeId: number | null;
  refWorkBId: number | null;
  relationKind: string | null;
}

/** Huella estructural: define si dos propuestas son "la misma" para idempotencia. */
export interface ProposalFingerprint {
  family: string;
  targetKind: string;
  contentClass: string;
  refWorkId: number | null;
  refEditionId: number | null;
  refVolumeId: number | null;
  refWorkBId: number | null;
  relationKind: string | null;
}

// ---------------------------------------------------------------------------
// Puertos (implementados por la infra con Prisma)
// ---------------------------------------------------------------------------
export interface CreateProposalReadPort {
  findByIdempotencyKey(key: string): Promise<ExistingProposal | null>;
  contentClassOfWork(workId: number): Promise<ContentClass | null>;
  contentClassOfEdition(editionId: number): Promise<ContentClass | null>;
  contentClassOfVolume(volumeId: number): Promise<ContentClass | null>;
}

export interface CreateProposalWritePort {
  /** Inserta la propuesta + su contribución originadora, atómico. */
  insertProposalWithOriginator(
    seed: CatalogProposalSeed,
  ): Promise<{ proposalId: number; contributionId: number; status: string }>;
}

// ---------------------------------------------------------------------------
// Errores de dominio (sin dependencia de Prisma ni del framework de datos)
// ---------------------------------------------------------------------------
/** La `createIdempotencyKey` ya se usó para una propuesta ESTRUCTURALMENTE distinta. */
export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
  constructor(
    message = "La clave de idempotencia ya se usó para otra propuesta distinta.",
  ) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

/** Señal de infra: el unique de `createIdempotencyKey` rechazó el insert (carrera). */
export class ProposalAlreadyExistsError extends Error {
  readonly code = "PROPOSAL_ALREADY_EXISTS" as const;
  constructor(readonly createIdempotencyKey: string) {
    super(`Ya existe una propuesta para la clave ${createIdempotencyKey}.`);
    this.name = "ProposalAlreadyExistsError";
  }
}

// ---------------------------------------------------------------------------
// Validación + derivación
// ---------------------------------------------------------------------------
const num = (v: number | null | undefined): number | null =>
  typeof v === "number" ? v : null;

/**
 * Chequeos ESTRUCTURALES puros (sin I/O): enums, matriz family×targetKind,
 * columnas de target pobladas por kind, reglas de relationKind y de contentClass
 * de entrada. Barato → sirve como `validate` (corre 2x en el pipeline).
 */
export function validateStructure(input: CreateCatalogProposalInput): void {
  if (!input.createIdempotencyKey || !input.createIdempotencyKey.trim())
    throw new ValidationError("Falta createIdempotencyKey.");
  if (!FAMILIES.includes(input.family))
    throw new ValidationError(`Familia inválida: ${input.family}.`);
  if (!TARGET_KINDS.includes(input.targetKind))
    throw new ValidationError(`targetKind inválido: ${input.targetKind}.`);
  if (!FAMILY_TARGETS[input.family].includes(input.targetKind))
    throw new ValidationError(
      `La familia ${input.family} no admite el target ${input.targetKind}.`,
    );

  const w = num(input.refWorkId);
  const e = num(input.refEditionId);
  const v = num(input.refVolumeId);
  const b = num(input.refWorkBId);
  const rel = input.relationKind ?? null;
  const need = (cond: boolean, msg: string) => {
    if (!cond) throw new ValidationError(msg);
  };

  switch (input.targetKind) {
    case "NEW_WORK":
      need(w === null && e === null && v === null && b === null && rel === null,
        "NEW_WORK no admite referencias de catálogo.");
      need(!!input.contentClass && CONTENT_CLASSES.includes(input.contentClass),
        "NEW_WORK requiere contentClass (MANGA|COMIC).");
      break;
    case "NEW_EDITION":
      need(w !== null && e === null && v === null && b === null && rel === null,
        "NEW_EDITION requiere solo refWorkId (obra padre).");
      break;
    case "NEW_VOLUME":
      need(e !== null && w === null && v === null && b === null && rel === null,
        "NEW_VOLUME requiere solo refEditionId (edición padre).");
      break;
    case "WORK":
      need(w !== null && e === null && v === null && b === null && rel === null,
        "WORK requiere solo refWorkId.");
      break;
    case "EDITION":
      need(e !== null && w === null && v === null && b === null && rel === null,
        "EDITION requiere solo refEditionId.");
      break;
    case "VOLUME":
      need(v !== null && w === null && e === null && b === null && rel === null,
        "VOLUME requiere solo refVolumeId.");
      break;
    case "STRUCTURAL":
      need(rel !== null && RELATION_KINDS.includes(rel),
        "STRUCTURAL requiere relationKind (DUPLICATE|BAD_MERGE).");
      need(w !== null && e === null && v === null,
        "STRUCTURAL requiere refWorkId (obra A) y no admite edición/volumen.");
      if (rel === "DUPLICATE")
        need(b !== null && b !== w,
          "DUPLICATE requiere refWorkBId distinto de refWorkId.");
      if (rel === "BAD_MERGE")
        need(b === null, "BAD_MERGE no admite refWorkBId.");
      break;
  }
}

/**
 * Deriva `contentClass` desde el catálogo según el targetKind (usa `sameContentClass`:
 * COMIC vs. resto) y valida existencia de las referencias. Devuelve la semilla lista
 * para insertar. Llama a `validateStructure` primero.
 */
export async function resolveSeed(
  read: CreateProposalReadPort,
  input: CreateCatalogProposalInput,
  originatorUserId: string,
): Promise<CatalogProposalSeed> {
  validateStructure(input);
  const w = num(input.refWorkId);
  const e = num(input.refEditionId);
  const v = num(input.refVolumeId);

  let contentClass: ContentClass;
  if (input.targetKind === "NEW_WORK") {
    contentClass = input.contentClass!; // validado en validateStructure
  } else {
    let derived: ContentClass | null;
    if (input.targetKind === "NEW_EDITION" || input.targetKind === "WORK" || input.targetKind === "STRUCTURAL")
      derived = await read.contentClassOfWork(w!);
    else if (input.targetKind === "NEW_VOLUME" || input.targetKind === "EDITION")
      derived = await read.contentClassOfEdition(e!);
    else derived = await read.contentClassOfVolume(v!); // VOLUME
    if (!derived)
      throw new ValidationError("La entidad de catálogo referenciada no existe.");
    if (input.contentClass && input.contentClass !== derived)
      throw new ValidationError(
        `contentClass ${input.contentClass} no coincide con la entidad referenciada (${derived}).`,
      );
    contentClass = derived;
  }

  return {
    family: input.family,
    targetKind: input.targetKind,
    contentClass,
    refWorkId: w,
    refEditionId: e,
    refVolumeId: v,
    refWorkBId: num(input.refWorkBId),
    relationKind: input.relationKind ?? null,
    createIdempotencyKey: input.createIdempotencyKey,
    originatorUserId,
  };
}

// ---------------------------------------------------------------------------
// Idempotencia (huella + reconciliación)
// ---------------------------------------------------------------------------
export function fingerprintOfSeed(s: CatalogProposalSeed): ProposalFingerprint {
  return {
    family: s.family,
    targetKind: s.targetKind,
    contentClass: s.contentClass,
    refWorkId: s.refWorkId,
    refEditionId: s.refEditionId,
    refVolumeId: s.refVolumeId,
    refWorkBId: s.refWorkBId,
    relationKind: s.relationKind,
  };
}

export function fingerprintOfExisting(p: ExistingProposal): ProposalFingerprint {
  return {
    family: p.family,
    targetKind: p.targetKind,
    contentClass: p.contentClass,
    refWorkId: p.refWorkId,
    refEditionId: p.refEditionId,
    refVolumeId: p.refVolumeId,
    refWorkBId: p.refWorkBId,
    relationKind: p.relationKind,
  };
}

export function sameFingerprint(a: ProposalFingerprint, b: ProposalFingerprint): boolean {
  return (
    a.family === b.family &&
    a.targetKind === b.targetKind &&
    a.contentClass === b.contentClass &&
    a.refWorkId === b.refWorkId &&
    a.refEditionId === b.refEditionId &&
    a.refVolumeId === b.refVolumeId &&
    a.refWorkBId === b.refWorkBId &&
    a.relationKind === b.relationKind
  );
}

/**
 * Reconciliación first-wins: si la key ya existe y la huella coincide → es un
 * replay compatible (recuperar). Si difiere → conflicto (misma key, propuesta
 * distinta). Lanza `IdempotencyConflictError` en el caso incompatible.
 */
export function assertCompatibleReplay(
  seed: CatalogProposalSeed,
  existing: ExistingProposal,
): void {
  if (!sameFingerprint(fingerprintOfSeed(seed), fingerprintOfExisting(existing)))
    throw new IdempotencyConflictError();
}
