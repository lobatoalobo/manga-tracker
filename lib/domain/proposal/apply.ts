/**
 * Dominio de "aplicar una propuesta al catálogo" (Community Contributions, ADR-006)
 * — primer vertical: SOLO `NEW_WORK`. Prisma-free. Apply es el único flujo de
 * Contributions que toca el catálogo; este slice toma una propuesta ACEPTADA con
 * `ResolutionRecord` positivo NO aplicado, construye un `WorkDraft` determinista a
 * partir de las claims `ACEPTADA` (mapping CERRADO: toda claim aceptada debe poder
 * mapearse; si no, falla) y deja que la infra cree exactamente un `Work` y rellene
 * `appliedWorkId` + `mutationCorrelationId` + `primaryTitleClaimId`.
 *
 * Idempotencia fuerte por el estado del `ResolutionRecord`: la fuente autoritativa de
 * "ya aplicada" es `mutationCorrelationId` (no una idempotency key de cliente, que es
 * advisory). `normTitle`/dedup se computan en INFRA (reusan lib/catalog); el dominio
 * NO importa Prisma. Reusa `ProposalNotFoundError` de RequestProposalInfo.
 */
import { ValidationError } from "@/lib/mutations";
import { ATTRIBUTE_KIND_LEVEL } from "@/lib/domain/proposal/addContribution";
import { ProposalNotFoundError } from "@/lib/domain/proposal/requestInfo";

export { ProposalNotFoundError } from "@/lib/domain/proposal/requestInfo";

export const TARGET_KIND_NEW_WORK = "NEW_WORK" as const;
export const PROPOSAL_STATUS_ACEPTADA = "ACEPTADA" as const;
export const RESOLUTION_OUTCOME_ACEPTADA = "ACEPTADA" as const;
export const CLAIM_RESULT_ACCEPTED = "ACEPTADA" as const;
export const CLAIM_RESULT_PROPOSED = "PROPUESTA" as const;

/**
 * Política CERRADA de proyección de claims WORK-level para NEW_WORK (Decisión A): cada
 * kind WORK válido está EXACTAMENTE en uno de estos dos conjuntos. La unión debe cubrir
 * todos los kinds WORK-level de `ATTRIBUTE_KIND_LEVEL` (comprobado en tests). Una claim
 * WORK de un kind no clasificado es un error duro (no se descarta en silencio).
 */
// Se proyectan hoy a columnas de `Work`.
export const WORK_MATERIALIZED_KINDS: ReadonlySet<string> = new Set([
  "TITLE_LOCALIZED", "TITLE_ROMAJI", "TITLE_NATIVE", "WORK_TYPE",
  "CREATOR_CREDIT", "SYNOPSIS_LOCALIZED", "EXTERNAL_WORK_ID",
]);
// Válidas WORK-level pero sin columna en `Work` hoy: quedan íntegras en `ProposalClaim`
// (evidencia de la resolución). Aceptadas, no materializadas; NO bloquean Apply.
export const WORK_ACCEPTED_NOT_MATERIALIZED_KINDS: ReadonlySet<string> = new Set([
  "TITLE_ALTERNATIVE", "ORIGINAL_LANGUAGE", "COUNTRY_OF_ORIGIN",
  "WORK_STATUS", "START_DATE", "END_DATE",
]);

/** Refs de catálogo que una aplicación puede producir (para el gate genérico). */
export type AppliedRef = "work" | "edition" | "volume";

/**
 * Refs esperadas por `targetKind` (tabla-dato; el clasificador NO ramifica por tipo).
 * Poblada SOLO con lo implementado hoy; un `targetKind` ausente → no soportado.
 */
export const APPLY_TARGET_REFS: Readonly<Record<string, ReadonlySet<AppliedRef>>> = {
  [TARGET_KIND_NEW_WORK]: new Set<AppliedRef>(["work"]),
};

/** Prioridad del título primario (menor gana). TITLE_ROMAJI=4, TITLE_NATIVE=5. */
const TITLE_LOCALE_PRIORITY: Readonly<Record<string, number>> = { "es-AR": 1, "es": 2, "en": 3 };
const TITLE_ROMAJI_PRIORITY = 4;
const TITLE_NATIVE_PRIORITY = 5;

/** Taxonomía WORK_TYPE → Work.type, acotada por contentClass (attribute-kinds §C). */
const WORK_TYPE_BY_CLASS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  MANGA: { MANGA: "MANGA", LIGHT_NOVEL: "LIGHT_NOVEL", ARTBOOK: "ARTBOOK", DATABOOK: "DATABOOK", OTHER_MANGA: "OTHER" },
  COMIC: { COMIC: "COMIC", OTHER_COMIC: "OTHER" },
};

/** Provider (EXTERNAL_WORK_ID) → columna de identidad externa del Work. */
const PROVIDER_FIELD: Readonly<Record<string, "anilistId" | "muId" | "mdId">> = {
  anilist: "anilistId", mangaupdates: "muId", mangadex: "mdId",
};

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
export interface ApplyCatalogProposalCommand {
  proposalId: string;
  idempotencyKey: string; // advisory
}

export interface ApplySeed {
  proposalId: number;
  idempotencyKey: string;
}

export interface ApplyOutcome {
  proposalId: number;
  resolutionRecordId: number;
  appliedWorkId: number;
  mutationCorrelationId: string;
  recovered: boolean;
}

/** Propuesta bajo lock (para elegibilidad + dedup). */
export interface LockedProposalForApply {
  id: number;
  status: string;
  targetKind: string;
  contentClass: string;
  version: number;
}

/** ResolutionRecord existente (gate de idempotencia + outcome). */
export interface ExistingResolutionForApply {
  id: number;
  outcome: string;
  mutationCorrelationId: string | null;
  appliedWorkId: number | null;
  appliedEditionId: number | null;
  appliedVolumeId: number | null;
}

/** Claim de la propuesta (para armar el draft). */
export interface ApplyClaimRow {
  id: number;
  attributeKind: string;
  value: unknown;
  result: string;
}

/**
 * Borrador de Work (Prisma-free). `normTitle` NO va acá: lo deriva la infra con
 * `normalizeTitle` (junto al dedup). `incomingType` alimenta `sameContentClass`.
 */
export interface WorkDraft {
  title: string;
  type: string;
  originalTitle: string | null;
  titleNative: string | null;
  titleEn: string | null;
  author: string | null;
  synopsisEs: string | null;
  synopsisEn: string | null;
  anilistId: number | null;
  muId: string | null;
  mdId: string | null;
  incomingType: "MANGA" | "COMIC";
  curated: string[];
  primaryTitleClaimId: number;
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------
/** El framework exige un read-port; Apply hace TODAS sus lecturas tx-bound en el
 * write-port, así que este puerto queda vacío por diseño. */
export type ApplyReadPort = Record<string, never>;

/** Escritura INDIVISIBLE bajo el lock de la propuesta (impl en infra). */
export interface ApplyWritePort {
  apply(seed: ApplySeed, correlationId: string): Promise<ApplyOutcome>;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------
export class TargetKindNotSupportedError extends Error {
  readonly code = "TARGET_KIND_NOT_SUPPORTED" as const;
  constructor(readonly targetKind: string) {
    super(`Apply no soporta todavía propuestas ${targetKind} (solo NEW_WORK).`);
    this.name = "TargetKindNotSupportedError";
  }
}
export class ProposalNotApplicableError extends Error {
  readonly code = "PROPOSAL_NOT_APPLICABLE" as const;
  constructor(readonly status: string) {
    super(`La propuesta no es aplicable (estado ${status}).`);
    this.name = "ProposalNotApplicableError";
  }
}
export class ResolutionNotFoundError extends Error {
  readonly code = "RESOLUTION_NOT_FOUND" as const;
  constructor() {
    super("La propuesta no tiene resolución.");
    this.name = "ResolutionNotFoundError";
  }
}
export class ResolutionNotPositiveError extends Error {
  readonly code = "RESOLUTION_NOT_POSITIVE" as const;
  constructor(readonly outcome: string) {
    super(`La resolución no es positiva (${outcome}).`);
    this.name = "ResolutionNotPositiveError";
  }
}
export class NoApplicableClaimsError extends Error {
  readonly code = "NO_APPLICABLE_CLAIMS" as const;
  constructor(message = "No hay claims aceptadas aplicables.") {
    super(message);
    this.name = "NoApplicableClaimsError";
  }
}
export class ClaimSetInvalidError extends Error {
  readonly code = "CLAIM_SET_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "ClaimSetInvalidError";
  }
}
export class UnsupportedClaimForApplyError extends Error {
  readonly code = "UNSUPPORTED_CLAIM_FOR_APPLY" as const;
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedClaimForApplyError";
  }
}
export class InsufficientCatalogDataError extends Error {
  readonly code = "INSUFFICIENT_CATALOG_DATA" as const;
  constructor(message: string) {
    super(message);
    this.name = "InsufficientCatalogDataError";
  }
}
export class CatalogConflictError extends Error {
  readonly code = "CATALOG_CONFLICT" as const;
  constructor(message = "El Work ya existe o hay un conflicto de identidad en el catálogo.") {
    super(message);
    this.name = "CatalogConflictError";
  }
}
export class InconsistentApplyStateError extends Error {
  readonly code = "INCONSISTENT_APPLY_STATE" as const;
  constructor(message = "El estado de aplicación del ResolutionRecord es inconsistente.") {
    super(message);
    this.name = "InconsistentApplyStateError";
  }
}

// ---------------------------------------------------------------------------
// Normalización del comando
// ---------------------------------------------------------------------------
export function buildApplySeed(command: ApplyCatalogProposalCommand): ApplySeed {
  if (!command.idempotencyKey || !command.idempotencyKey.trim())
    throw new ValidationError("Falta idempotencyKey.");
  const proposalId = Number(command.proposalId);
  if (!Number.isInteger(proposalId) || proposalId <= 0)
    throw new ValidationError("proposalId inválido.");
  return { proposalId, idempotencyKey: command.idempotencyKey };
}

// ---------------------------------------------------------------------------
// Gate de aplicación (fuente autoritativa: mutationCorrelationId)
// ---------------------------------------------------------------------------
export type ApplyState = "NOT_APPLIED" | "APPLIED" | "INCONSISTENT";

const ALL_REFS: readonly AppliedRef[] = ["work", "edition", "volume"];

/**
 * Gate genérico parametrizado por el conjunto de refs esperadas (sin ramas por target).
 * `mutationCorrelationId` es la autoridad de idempotencia; las refs corroboran coherencia.
 * NOT_APPLIED: sin correlation y sin ninguna ref. APPLIED: con correlation, todas las
 * esperadas presentes y ninguna inesperada. Cualquier otra combinación: INCONSISTENT.
 */
export function classifyApplyState(
  r: ExistingResolutionForApply,
  expected: ReadonlySet<AppliedRef>,
): ApplyState {
  const present: Record<AppliedRef, boolean> = {
    work: r.appliedWorkId !== null,
    edition: r.appliedEditionId !== null,
    volume: r.appliedVolumeId !== null,
  };
  const hasCorr = r.mutationCorrelationId !== null;
  const anyPresent = ALL_REFS.some((k) => present[k]);
  const allExpected = ALL_REFS.every((k) => !expected.has(k) || present[k]);
  const anyUnexpected = ALL_REFS.some((k) => !expected.has(k) && present[k]);
  if (!hasCorr && !anyPresent) return "NOT_APPLIED";
  // `anyPresent` endurece el caso degenerado `expected` vacío: correlation sola (sin
  // ninguna ref) nunca es APPLIED. Redundante para targets con ≥1 ref esperada
  // (allExpected ya implica presencia), pero evita un falso positivo por construcción.
  if (hasCorr && anyPresent && allExpected && !anyUnexpected) return "APPLIED";
  return "INCONSISTENT";
}

// ---------------------------------------------------------------------------
// Lectores de value (Json opaco → forma tipada; sin pérdida)
// ---------------------------------------------------------------------------
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function localized(v: unknown): { language: string; text: string } | null {
  const r = asRecord(v);
  if (!r) return null;
  const language = typeof r.language === "string" ? r.language : null;
  const text = typeof r.text === "string" ? r.text.trim() : null;
  return language && text ? { language, text } : null;
}
function plainText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  const r = asRecord(v);
  return r && typeof r.text === "string" ? r.text.trim() || null : null;
}
function enumText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  const r = asRecord(v);
  return r && typeof r.value === "string" ? r.value.trim() || null : null;
}

// ---------------------------------------------------------------------------
// Construcción del WorkDraft (determinista, mapping cerrado)
// ---------------------------------------------------------------------------
export function buildWorkDraft(accepted: ApplyClaimRow[], contentClass: string): WorkDraft {
  if (contentClass !== "MANGA" && contentClass !== "COMIC")
    throw new ClaimSetInvalidError(`contentClass inválido: ${contentClass}.`);
  if (accepted.length < 1) throw new NoApplicableClaimsError("La resolución no tiene claims aceptadas.");

  // 1. Política cerrada de proyección + cardinalidad de los materializados:
  //    - nivel ≠ WORK / kind desconocido → error duro (incompatibilidad de nivel);
  //    - WORK aceptada-no-materializada (política) → se OMITE (queda en el ledger);
  //    - WORK no clasificada por la política → error duro (no se descarta en silencio);
  //    - WORK materializada → valida cardinalidad/sub-clave y se proyecta.
  const seenSingular = new Set<string>(); // WORK_TYPE, TITLE_ROMAJI, TITLE_NATIVE
  const seenSubkey = new Set<string>(); // kind|subclave (set kinds)
  for (const c of accepted) {
    const level = ATTRIBUTE_KIND_LEVEL[c.attributeKind];
    if (level !== "WORK")
      throw new UnsupportedClaimForApplyError(
        level
          ? `La claim ${c.attributeKind} (nivel ${level}) no aplica a un NEW_WORK.`
          : `Apply no reconoce el kind de claim ${c.attributeKind}.`,
      );
    if (WORK_ACCEPTED_NOT_MATERIALIZED_KINDS.has(c.attributeKind)) continue; // evidencia; no se proyecta
    if (!WORK_MATERIALIZED_KINDS.has(c.attributeKind))
      throw new UnsupportedClaimForApplyError(
        `La claim WORK ${c.attributeKind} no está clasificada por la política de Apply.`,
      );
    if (c.attributeKind === "WORK_TYPE" || c.attributeKind === "TITLE_ROMAJI" || c.attributeKind === "TITLE_NATIVE") {
      if (seenSingular.has(c.attributeKind))
        throw new ClaimSetInvalidError(`Más de una claim aceptada para el atributo singular ${c.attributeKind}.`);
      seenSingular.add(c.attributeKind);
    } else {
      const subkey = subkeyFor(c);
      const k = `${c.attributeKind}|${subkey}`;
      if (seenSubkey.has(k))
        throw new ClaimSetInvalidError(`Colisión de sub-clave en ${c.attributeKind} (${subkey}).`);
      seenSubkey.add(k);
    }
  }

  const curated: string[] = [];
  const setField = (name: string) => { if (!curated.includes(name)) curated.push(name); };

  // 2. Título primario (prioridad determinista) + primaryTitleClaimId.
  const primary = selectPrimaryTitle(accepted);
  if (!primary) throw new NoApplicableClaimsError("Falta una claim de título aplicable.");
  const title = primary.text;
  setField("title");

  // 3. Campos Work (solo si hay claim aceptada; verbatim, sin inventar).
  const romaji = pickText(accepted, "TITLE_ROMAJI", plainText);
  const native = pickLocalizedText(accepted, "TITLE_NATIVE");
  const titleEn = pickLocalizedByLang(accepted, "TITLE_LOCALIZED", "en");
  const author = pickStoryAuthor(accepted);
  const synopsisEs = pickLocalizedByLang(accepted, "SYNOPSIS_LOCALIZED", "es-AR")
    ?? pickLocalizedByLang(accepted, "SYNOPSIS_LOCALIZED", "es");
  const synopsisEn = pickLocalizedByLang(accepted, "SYNOPSIS_LOCALIZED", "en");
  const type = resolveType(accepted, contentClass, setField);
  const ext = resolveExternalIds(accepted);

  if (romaji) setField("originalTitle");
  if (native) setField("titleNative");
  if (titleEn) setField("titleEn");
  if (author) setField("author");
  if (synopsisEs) setField("synopsisEs");
  if (synopsisEn) setField("synopsisEn");
  if (ext.anilistId !== null) setField("anilistId");
  if (ext.muId !== null) setField("muId");
  if (ext.mdId !== null) setField("mdId");

  return {
    title, type,
    originalTitle: romaji, titleNative: native, titleEn,
    author, synopsisEs, synopsisEn,
    anilistId: ext.anilistId, muId: ext.muId, mdId: ext.mdId,
    incomingType: contentClass,
    curated: curated.sort(),
    primaryTitleClaimId: primary.claimId,
  };
}

function subkeyFor(c: ApplyClaimRow): string {
  if (c.attributeKind === "TITLE_LOCALIZED" || c.attributeKind === "SYNOPSIS_LOCALIZED") {
    const l = localized(c.value);
    return l ? l.language : "?";
  }
  if (c.attributeKind === "EXTERNAL_WORK_ID") {
    const r = asRecord(c.value);
    return r && typeof r.provider === "string" ? r.provider.toLowerCase() : "?";
  }
  if (c.attributeKind === "CREATOR_CREDIT") {
    const r = asRecord(c.value);
    const name = r && typeof r.displayName === "string" ? r.displayName : "?";
    const role = r && typeof r.role === "string" ? r.role : "?";
    return `${name}::${role}`;
  }
  return "?";
}

function selectPrimaryTitle(accepted: ApplyClaimRow[]): { text: string; claimId: number } | null {
  // Candidatos (prioridad, texto, claimId); menor prioridad gana.
  const candidates: { priority: number; text: string; claimId: number }[] = [];
  for (const c of accepted) {
    if (c.attributeKind === "TITLE_LOCALIZED") {
      const l = localized(c.value);
      if (l && l.language in TITLE_LOCALE_PRIORITY)
        candidates.push({ priority: TITLE_LOCALE_PRIORITY[l.language], text: l.text, claimId: c.id });
    } else if (c.attributeKind === "TITLE_ROMAJI") {
      const t = plainText(c.value);
      if (t) candidates.push({ priority: TITLE_ROMAJI_PRIORITY, text: t, claimId: c.id });
    } else if (c.attributeKind === "TITLE_NATIVE") {
      const l = localized(c.value);
      const t = l ? l.text : plainText(c.value);
      if (t) candidates.push({ priority: TITLE_NATIVE_PRIORITY, text: t, claimId: c.id });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priority - b.priority);
  return { text: candidates[0].text, claimId: candidates[0].claimId };
}

function pickText(accepted: ApplyClaimRow[], kind: string, read: (v: unknown) => string | null): string | null {
  const c = accepted.find((x) => x.attributeKind === kind);
  return c ? read(c.value) : null;
}
function pickLocalizedText(accepted: ApplyClaimRow[], kind: string): string | null {
  const c = accepted.find((x) => x.attributeKind === kind);
  if (!c) return null;
  const l = localized(c.value);
  return l ? l.text : plainText(c.value);
}
function pickLocalizedByLang(accepted: ApplyClaimRow[], kind: string, language: string): string | null {
  for (const c of accepted) {
    if (c.attributeKind !== kind) continue;
    const l = localized(c.value);
    if (l && l.language === language) return l.text;
  }
  return null;
}
function pickStoryAuthor(accepted: ApplyClaimRow[]): string | null {
  let best: { order: number; name: string } | null = null;
  for (const c of accepted) {
    if (c.attributeKind !== "CREATOR_CREDIT") continue;
    const r = asRecord(c.value);
    if (!r || r.role !== "STORY") continue;
    const name = typeof r.displayName === "string" ? r.displayName.trim() : "";
    if (!name) continue;
    const order = typeof r.order === "number" ? r.order : Number.MAX_SAFE_INTEGER;
    if (!best || order < best.order) best = { order, name };
  }
  return best ? best.name : null;
}
function resolveType(accepted: ApplyClaimRow[], contentClass: string, setField: (n: string) => void): string {
  const c = accepted.find((x) => x.attributeKind === "WORK_TYPE");
  if (!c) return contentClass; // fallback por contentClass
  const raw = enumText(c.value);
  const table = WORK_TYPE_BY_CLASS[contentClass] ?? {};
  if (!raw || !(raw in table))
    throw new ClaimSetInvalidError(`WORK_TYPE "${raw ?? ""}" incoherente con contentClass ${contentClass}.`);
  setField("type");
  return table[raw];
}
function resolveExternalIds(accepted: ApplyClaimRow[]): { anilistId: number | null; muId: string | null; mdId: string | null } {
  const out: { anilistId: number | null; muId: string | null; mdId: string | null } = { anilistId: null, muId: null, mdId: null };
  for (const c of accepted) {
    if (c.attributeKind !== "EXTERNAL_WORK_ID") continue;
    const r = asRecord(c.value);
    const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : null;
    const externalId = r && (typeof r.externalId === "string" || typeof r.externalId === "number") ? String(r.externalId).trim() : null;
    if (!provider || !externalId || !(provider in PROVIDER_FIELD))
      throw new ClaimSetInvalidError("EXTERNAL_WORK_ID con provider/externalId inválido.");
    const field = PROVIDER_FIELD[provider];
    if (field === "anilistId") {
      const n = Number(externalId);
      if (!Number.isInteger(n)) throw new InsufficientCatalogDataError("anilistId externo no es un entero.");
      out.anilistId = n;
    } else {
      out[field] = externalId;
    }
  }
  return out;
}
