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
export const TARGET_KIND_NEW_EDITION = "NEW_EDITION" as const;
export const TARGET_KIND_NEW_VOLUME = "NEW_VOLUME" as const;
export const TARGET_KIND_VOLUME = "VOLUME" as const; // corrección de volumen existente (familia Mutation)
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
  [TARGET_KIND_NEW_EDITION]: new Set<AppliedRef>(["edition"]),
  [TARGET_KIND_NEW_VOLUME]: new Set<AppliedRef>(["volume"]),
  [TARGET_KIND_VOLUME]: new Set<AppliedRef>(["volume"]), // Mutation × Volume: ref = volumen afectado
};

/**
 * Política CERRADA de proyección de claims EDITION-level para NEW_EDITION (mismo patrón
 * que WORK): partición exhaustiva y disjunta sobre los kinds EDITION de
 * `ATTRIBUTE_KIND_LEVEL` (comprobado en tests). Kind EDITION no clasificado → error duro.
 */
// Se proyectan hoy a columnas de `PublisherEdition`.
export const EDITION_MATERIALIZED_KINDS: ReadonlySet<string> = new Set([
  "EDITION_PUBLISHER", "EDITION_COUNTRY", "EDITION_LANGUAGE", "EDITION_STATUS",
  "EDITION_ANNOUNCED_TOTAL_VOLUMES", "EXTERNAL_EDITION_ID",
]);
// Válidas EDITION-level pero sin columna en `PublisherEdition` hoy: quedan en el ledger.
export const EDITION_ACCEPTED_NOT_MATERIALIZED_KINDS: ReadonlySet<string> = new Set([
  "EDITION_FORMAT", "EDITION_LABEL_OR_IMPRINT", "EDITION_RELEASE_DATE", "EDITION_IS_UPCOMING",
]);

/** Provider (EXTERNAL_EDITION_ID) admitido en MVP → columna de identidad externa. */
const EDITION_PROVIDER_FIELD: Readonly<Record<string, "whakoomId">> = {
  whakoom: "whakoomId",
};

/**
 * Política CERRADA de proyección de claims VOLUME-level para NEW_VOLUME (mismo patrón que
 * WORK/EDITION): partición exhaustiva y disjunta sobre los kinds VOLUME de
 * `ATTRIBUTE_KIND_LEVEL` (comprobado en tests). Kind VOLUME no clasificado → error duro.
 */
// Se proyectan hoy a columnas de `Volume`.
export const VOLUME_MATERIALIZED_KINDS: ReadonlySet<string> = new Set([
  "VOLUME_NUMBER", "VOLUME_ISBN", "EXTERNAL_VOLUME_ID",
]);
// Válidas VOLUME-level pero sin columna materializable hoy: quedan en el ledger.
// `VOLUME_COVER` existe como `coverImage` pero su promoción es efecto diferido (MVP-B).
export const VOLUME_ACCEPTED_NOT_MATERIALIZED_KINDS: ReadonlySet<string> = new Set([
  "VOLUME_TITLE", "VOLUME_RELEASE_DATE", "VOLUME_PAGE_COUNT", "VOLUME_STATUS", "VOLUME_COVER",
]);

/** Provider (EXTERNAL_VOLUME_ID) admitido en MVP → columna de identidad externa. */
const VOLUME_PROVIDER_FIELD: Readonly<Record<string, "whakoomComicId">> = {
  whakoom: "whakoomComicId",
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
  targetKind: string; // "NEW_WORK" | "NEW_EDITION"
  appliedWorkId: number | null;
  appliedEditionId: number | null;
  appliedVolumeId: number | null;
  mutationCorrelationId: string;
  recovered: boolean;
}

/** Propuesta bajo lock (para elegibilidad + dedup). `refWorkId` = Work padre (NEW_EDITION);
 * `refEditionId` = edición padre (NEW_VOLUME); `refVolumeId` = volumen target (VOLUME). */
export interface LockedProposalForApply {
  id: number;
  status: string;
  targetKind: string;
  contentClass: string;
  version: number;
  refWorkId: number | null;
  refEditionId: number | null;
  refVolumeId: number | null;
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

/** Claim de la propuesta (intake compartido del kernel). `claimOperation` lo requiere la
 * familia Mutation (ADR-007); la familia Creation lo ignora (asume afirmación). */
export interface ApplyClaimRow {
  id: number;
  attributeKind: string;
  value: unknown;
  claimOperation: string;
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

/**
 * Borrador de edición (Prisma-free). `slug` y `normTitle` NO van acá: los deriva la
 * infra justo antes del `create` (`communityEditionSlug` / `normalizeTitle`), por
 * simetría con `WorkDraft` (que tampoco carga `normTitle`). `title` viene del Work padre.
 */
export interface EditionDraft {
  publisher: string;
  language: string;
  country: string | null;
  status: string | null;
  volumes: number;
  volumesLocked: boolean;
  whakoomId: string | null;
  title: string; // Work padre
  workId: number; // refWorkId
}

/**
 * Algoritmo PURO del slug de edición de comunidad. Codifica `(workId, language)`; el
 * `publisher` completa la identidad de dominio dentro de `@@unique([publisher, slug])`.
 * Namespace `cc:` reservado; `:` no pertenece al alfabeto de `slugifyTitle` → nunca
 * colisiona con un slug del crawler. Determinista y estable frente a replays.
 */
export function communityEditionSlug(workId: number, language: string): string {
  return `cc:w${workId}:${language}`;
}

/**
 * Borrador de volumen (Prisma-free). `Volume` no tiene slug/normTitle → el draft solo
 * lleva valores de dominio. `editionId` = edición padre (refEditionId). NO carga
 * `coverImage` (promoción de portada diferida). Paralelo a Work/EditionDraft.
 */
export interface VolumeDraft {
  editionId: number;
  number: number;
  isbn: string | null;
  whakoomComicId: string | null;
}

/**
 * Patch de volumen (familia Mutation, ADR-007): diff PARCIAL sobre las columnas
 * materializables de `Volume`. La **presencia** de una clave = "tocar"; su **ausencia** =
 * "preservar" (ausencia ≠ null). Un valor `null` = borrado explícito (solo columnas
 * nullable). NO incluye `editionId` (no re-parenta) ni `coverImage` (no materializado).
 */
export interface VolumePatch {
  number?: number;
  isbn?: string | null;
  whakoomComicId?: string | null;
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
export class ParentWorkNotFoundError extends Error {
  readonly code = "PARENT_WORK_NOT_FOUND" as const;
  constructor() {
    super("La obra padre de la edición no existe.");
    this.name = "ParentWorkNotFoundError";
  }
}
export class ParentEditionNotFoundError extends Error {
  readonly code = "PARENT_EDITION_NOT_FOUND" as const;
  constructor() {
    super("La edición padre del volumen no existe.");
    this.name = "ParentEditionNotFoundError";
  }
}
export class TargetVolumeNotFoundError extends Error {
  readonly code = "TARGET_VOLUME_NOT_FOUND" as const;
  constructor() {
    super("El volumen a corregir no existe.");
    this.name = "TargetVolumeNotFoundError";
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
/** Escalar de texto (string | {value|text}), trim; vacío o no-texto → null. */
function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  const r = asRecord(v);
  if (r) {
    if (typeof r.value === "string") return r.value.trim() || null;
    if (typeof r.text === "string") return r.text.trim() || null;
  }
  return null;
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

// ---------------------------------------------------------------------------
// Construcción del EditionDraft (NEW_EDITION; mapping cerrado, paralelo a WorkDraft)
// ---------------------------------------------------------------------------
function scalarNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  const r = asRecord(v);
  return r && typeof r.value === "number" ? r.value : null;
}

function resolveEditionExternalId(accepted: ApplyClaimRow[]): string | null {
  for (const c of accepted) {
    if (c.attributeKind !== "EXTERNAL_EDITION_ID") continue;
    const r = asRecord(c.value);
    const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : null;
    const externalId = r && (typeof r.externalId === "string" || typeof r.externalId === "number") ? String(r.externalId).trim() : null;
    if (!provider || !externalId || !(provider in EDITION_PROVIDER_FIELD))
      throw new ClaimSetInvalidError("EXTERNAL_EDITION_ID con provider/externalId inválido.");
    return externalId; // whakoomId
  }
  return null;
}

/**
 * Arma el `EditionDraft` desde las claims ACEPTADA (misma mecánica cerrada que
 * `buildWorkDraft`): política EDITION (materializada / aceptada-no-materializada / error
 * de nivel / no clasificada), cardinalidad, y set materializado hard
 * (publisher+language+country). `title`/`workId` vienen del Work padre. `slug`/`normTitle`
 * los deriva la infra. Sin extraer `ProjectionPolicy` (deuda diferida).
 */
export function buildEditionDraft(
  accepted: ApplyClaimRow[],
  parentTitle: string,
  parentWorkId: number,
): EditionDraft {
  if (accepted.length < 1) throw new NoApplicableClaimsError("La resolución no tiene claims aceptadas.");

  const seenSingular = new Set<string>();
  const seenSubkey = new Set<string>();
  for (const c of accepted) {
    const level = ATTRIBUTE_KIND_LEVEL[c.attributeKind];
    if (level !== "EDITION")
      throw new UnsupportedClaimForApplyError(
        level
          ? `La claim ${c.attributeKind} (nivel ${level}) no aplica a un NEW_EDITION.`
          : `Apply no reconoce el kind de claim ${c.attributeKind}.`,
      );
    if (EDITION_ACCEPTED_NOT_MATERIALIZED_KINDS.has(c.attributeKind)) continue; // evidencia; no se proyecta
    if (!EDITION_MATERIALIZED_KINDS.has(c.attributeKind))
      throw new UnsupportedClaimForApplyError(
        `La claim EDITION ${c.attributeKind} no está clasificada por la política de Apply.`,
      );
    if (c.attributeKind === "EXTERNAL_EDITION_ID") {
      const r = asRecord(c.value);
      const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : "?";
      const k = `EXTERNAL_EDITION_ID|${provider}`;
      if (seenSubkey.has(k)) throw new ClaimSetInvalidError(`Colisión de sub-clave en EXTERNAL_EDITION_ID (${provider}).`);
      seenSubkey.add(k);
    } else {
      if (seenSingular.has(c.attributeKind))
        throw new ClaimSetInvalidError(`Más de una claim aceptada para el atributo singular ${c.attributeKind}.`);
      seenSingular.add(c.attributeKind);
    }
  }

  const publisher = pickText(accepted, "EDITION_PUBLISHER", enumText);
  const language = pickText(accepted, "EDITION_LANGUAGE", enumText);
  const country = pickText(accepted, "EDITION_COUNTRY", enumText);
  const status = pickText(accepted, "EDITION_STATUS", enumText);
  if (!publisher || !language || !country)
    throw new InsufficientCatalogDataError("Faltan datos mínimos de edición (publisher, language, country).");

  const volClaim = accepted.find((x) => x.attributeKind === "EDITION_ANNOUNCED_TOTAL_VOLUMES");
  let volumes = 0;
  let volumesLocked = false;
  if (volClaim) {
    const n = scalarNumber(volClaim.value);
    if (n === null || !Number.isInteger(n) || n < 0)
      throw new ClaimSetInvalidError("EDITION_ANNOUNCED_TOTAL_VOLUMES inválido (int ≥ 0).");
    volumes = n;
    volumesLocked = true;
  }

  const whakoomId = resolveEditionExternalId(accepted);

  return { publisher, language, country, status, volumes, volumesLocked, whakoomId, title: parentTitle, workId: parentWorkId };
}

// ---------------------------------------------------------------------------
// Construcción del VolumeDraft (NEW_VOLUME; mapping cerrado, paralelo a Work/Edition)
// ---------------------------------------------------------------------------
function resolveVolumeExternalId(accepted: ApplyClaimRow[]): string | null {
  for (const c of accepted) {
    if (c.attributeKind !== "EXTERNAL_VOLUME_ID") continue;
    const r = asRecord(c.value);
    const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : null;
    const externalId = r && (typeof r.externalId === "string" || typeof r.externalId === "number") ? String(r.externalId).trim() : null;
    if (!provider || !externalId || !(provider in VOLUME_PROVIDER_FIELD))
      throw new ClaimSetInvalidError("EXTERNAL_VOLUME_ID con provider/externalId inválido.");
    return externalId; // whakoomComicId
  }
  return null;
}

/**
 * Arma el `VolumeDraft` desde las claims ACEPTADA (misma mecánica cerrada que
 * build{Work,Edition}Draft): política VOLUME, cardinalidad y `VOLUME_NUMBER` requerido.
 * `editionId` viene del padre. Precedencia semántica: 0 claims aceptadas →
 * `NoApplicableClaimsError`; hay claims pero falta `VOLUME_NUMBER` →
 * `InsufficientCatalogDataError`. Sin extraer `ProjectionPolicy` (deuda diferida).
 */
export function buildVolumeDraft(accepted: ApplyClaimRow[], parentEditionId: number): VolumeDraft {
  if (accepted.length < 1) throw new NoApplicableClaimsError("La resolución no tiene claims aceptadas.");

  const seenSingular = new Set<string>();
  const seenSubkey = new Set<string>();
  for (const c of accepted) {
    const level = ATTRIBUTE_KIND_LEVEL[c.attributeKind];
    if (level !== "VOLUME")
      throw new UnsupportedClaimForApplyError(
        level
          ? `La claim ${c.attributeKind} (nivel ${level}) no aplica a un NEW_VOLUME.`
          : `Apply no reconoce el kind de claim ${c.attributeKind}.`,
      );
    if (VOLUME_ACCEPTED_NOT_MATERIALIZED_KINDS.has(c.attributeKind)) continue; // evidencia; no se proyecta
    if (!VOLUME_MATERIALIZED_KINDS.has(c.attributeKind))
      throw new UnsupportedClaimForApplyError(
        `La claim VOLUME ${c.attributeKind} no está clasificada por la política de Apply.`,
      );
    if (c.attributeKind === "EXTERNAL_VOLUME_ID") {
      const r = asRecord(c.value);
      const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : "?";
      const k = `EXTERNAL_VOLUME_ID|${provider}`;
      if (seenSubkey.has(k)) throw new ClaimSetInvalidError(`Colisión de sub-clave en EXTERNAL_VOLUME_ID (${provider}).`);
      seenSubkey.add(k);
    } else {
      if (seenSingular.has(c.attributeKind))
        throw new ClaimSetInvalidError(`Más de una claim aceptada para el atributo singular ${c.attributeKind}.`);
      seenSingular.add(c.attributeKind);
    }
  }

  // VOLUME_NUMBER: requerido. Ausencia → InsufficientCatalogData; presente inválido → ClaimSetInvalid.
  const numClaim = accepted.find((x) => x.attributeKind === "VOLUME_NUMBER");
  if (!numClaim) throw new InsufficientCatalogDataError("Falta VOLUME_NUMBER para crear el volumen.");
  const number = scalarNumber(numClaim.value);
  if (number === null || !Number.isInteger(number) || number < 0)
    throw new ClaimSetInvalidError("VOLUME_NUMBER inválido (entero ≥ 0).");

  // VOLUME_ISBN: opcional; si está presente debe ser texto no vacío (no se silencia el vacío).
  const isbnClaim = accepted.find((x) => x.attributeKind === "VOLUME_ISBN");
  let isbn: string | null = null;
  if (isbnClaim) {
    const t = scalarText(isbnClaim.value);
    if (t === null) throw new ClaimSetInvalidError("VOLUME_ISBN vacío o no es un texto válido.");
    isbn = t;
  }

  const whakoomComicId = resolveVolumeExternalId(accepted);

  return { editionId: parentEditionId, number, isbn, whakoomComicId };
}

// ---------------------------------------------------------------------------
// Construcción del VolumePatch (Mutation × Volume; ADR-007)
// ---------------------------------------------------------------------------
const CLAIM_OP_SET = "SET" as const;
const CLAIM_OP_ADD = "ADD" as const;
/** Operaciones de vaciado (semántica general ADR-007): quitar / marcar. */
const ERASE_OPS: ReadonlySet<string> = new Set(["REMOVE", "MARK_UNKNOWN", "MARK_NOT_APPLICABLE"]);

/** Valida un `EXTERNAL_VOLUME_ID` puntual (proveedor Whakoom, id no vacío) para SET/ADD. */
function readVolumeExternalIdValue(c: ApplyClaimRow): string {
  const r = asRecord(c.value);
  const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : null;
  const externalId = r && (typeof r.externalId === "string" || typeof r.externalId === "number") ? String(r.externalId).trim() : null;
  if (!provider || !externalId || !(provider in VOLUME_PROVIDER_FIELD))
    throw new ClaimSetInvalidError("EXTERNAL_VOLUME_ID con provider/externalId inválido.");
  return externalId;
}

/**
 * Arma el `VolumePatch` desde las claims ACEPTADA honrando `claimOperation` (ADR-007,
 * familia Mutation). Clasificación/cardinalidad idénticas a `buildVolumeDraft` (sin
 * extraer una política compartida: deuda diferida). Un patch **vacío** (ninguna columna
 * tocada) es legítimo → la infra lo trata como no-op exitoso. Reglas por atributo:
 * - `VOLUME_NUMBER` (columna obligatoria): solo afirmar; vaciar/agregar → error.
 * - `VOLUME_ISBN` (nullable): afirmar (texto no vacío) o vaciar; agregar → error.
 * - `EXTERNAL_VOLUME_ID` (slot único Whakoom): afirmar/agregar (=fijar) o vaciar.
 */
export function buildVolumePatch(accepted: ApplyClaimRow[]): VolumePatch {
  const seenSingular = new Set<string>();
  const seenSubkey = new Set<string>();
  for (const c of accepted) {
    const level = ATTRIBUTE_KIND_LEVEL[c.attributeKind];
    if (level !== "VOLUME")
      throw new UnsupportedClaimForApplyError(
        level
          ? `La claim ${c.attributeKind} (nivel ${level}) no aplica a un VOLUME.`
          : `Apply no reconoce el kind de claim ${c.attributeKind}.`,
      );
    if (VOLUME_ACCEPTED_NOT_MATERIALIZED_KINDS.has(c.attributeKind)) continue; // evidencia; no se proyecta
    if (!VOLUME_MATERIALIZED_KINDS.has(c.attributeKind))
      throw new UnsupportedClaimForApplyError(
        `La claim VOLUME ${c.attributeKind} no está clasificada por la política de Apply.`,
      );
    if (c.attributeKind === "EXTERNAL_VOLUME_ID") {
      const r = asRecord(c.value);
      const provider = r && typeof r.provider === "string" ? r.provider.toLowerCase() : "?";
      const k = `EXTERNAL_VOLUME_ID|${provider}`;
      if (seenSubkey.has(k)) throw new ClaimSetInvalidError(`Colisión de sub-clave en EXTERNAL_VOLUME_ID (${provider}).`);
      seenSubkey.add(k);
    } else {
      if (seenSingular.has(c.attributeKind))
        throw new ClaimSetInvalidError(`Más de una claim aceptada para el atributo singular ${c.attributeKind}.`);
      seenSingular.add(c.attributeKind);
    }
  }

  const patch: VolumePatch = {};

  const numClaim = accepted.find((x) => x.attributeKind === "VOLUME_NUMBER");
  if (numClaim) {
    const op = numClaim.claimOperation;
    if (op === CLAIM_OP_ADD)
      throw new ClaimSetInvalidError("ADD no aplica a VOLUME_NUMBER (atributo escalar).");
    if (ERASE_OPS.has(op))
      throw new ClaimSetInvalidError("VOLUME_NUMBER no admite vaciado (columna obligatoria).");
    if (op !== CLAIM_OP_SET)
      throw new ClaimSetInvalidError(`Operación no soportada para VOLUME_NUMBER: ${op}.`);
    const n = scalarNumber(numClaim.value);
    if (n === null || !Number.isInteger(n) || n < 0)
      throw new ClaimSetInvalidError("VOLUME_NUMBER inválido (entero ≥ 0).");
    patch.number = n;
  }

  const isbnClaim = accepted.find((x) => x.attributeKind === "VOLUME_ISBN");
  if (isbnClaim) {
    const op = isbnClaim.claimOperation;
    if (op === CLAIM_OP_ADD)
      throw new ClaimSetInvalidError("ADD no aplica a VOLUME_ISBN (atributo escalar).");
    if (ERASE_OPS.has(op)) {
      patch.isbn = null;
    } else if (op === CLAIM_OP_SET) {
      const t = scalarText(isbnClaim.value);
      if (t === null) throw new ClaimSetInvalidError("VOLUME_ISBN vacío o no es un texto válido.");
      patch.isbn = t;
    } else {
      throw new ClaimSetInvalidError(`Operación no soportada para VOLUME_ISBN: ${op}.`);
    }
  }

  const extClaim = accepted.find((x) => x.attributeKind === "EXTERNAL_VOLUME_ID");
  if (extClaim) {
    const op = extClaim.claimOperation;
    if (ERASE_OPS.has(op)) {
      patch.whakoomComicId = null;
    } else if (op === CLAIM_OP_SET || op === CLAIM_OP_ADD) {
      patch.whakoomComicId = readVolumeExternalIdValue(extClaim);
    } else {
      throw new ClaimSetInvalidError(`Operación no soportada para EXTERNAL_VOLUME_ID: ${op}.`);
    }
  }

  return patch;
}
