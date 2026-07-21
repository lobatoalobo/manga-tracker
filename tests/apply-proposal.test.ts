import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  runMutation,
  ValidationError,
  type Actor,
  type AuditEntry,
  type AuditSink,
  type TransactionRunner,
} from "@/lib/mutations";
import {
  buildApplySeed,
  buildWorkDraft,
  buildEditionDraft,
  buildVolumeDraft,
  buildVolumePatch,
  communityEditionSlug,
  classifyApplyState,
  WORK_MATERIALIZED_KINDS,
  WORK_ACCEPTED_NOT_MATERIALIZED_KINDS,
  EDITION_MATERIALIZED_KINDS,
  EDITION_ACCEPTED_NOT_MATERIALIZED_KINDS,
  VOLUME_MATERIALIZED_KINDS,
  VOLUME_ACCEPTED_NOT_MATERIALIZED_KINDS,
  NoApplicableClaimsError,
  ClaimSetInvalidError,
  UnsupportedClaimForApplyError,
  TargetKindNotSupportedError,
  ProposalNotApplicableError,
  ProposalNotFoundError,
  ResolutionNotFoundError,
  ResolutionNotPositiveError,
  CatalogConflictError,
  InconsistentApplyStateError,
  InsufficientCatalogDataError,
  ParentWorkNotFoundError,
  ParentEditionNotFoundError,
  TargetVolumeNotFoundError,
  type AppliedRef,
  type ApplyClaimRow,
  type ApplyReadPort,
  type ApplyWritePort,
  type ExistingResolutionForApply,
} from "@/lib/domain/proposal/apply";
import { ATTRIBUTE_KIND_LEVEL } from "@/lib/domain/proposal/addContribution";

/** Refs esperadas del vertical NEW_WORK (equivalencia del gate previo). */
const WORK_REFS: ReadonlySet<AppliedRef> = new Set<AppliedRef>(["work"]);
/** Refs esperadas del vertical NEW_EDITION (gate específico). */
const EDITION_REFS: ReadonlySet<AppliedRef> = new Set<AppliedRef>(["edition"]);
/** Refs esperadas del vertical NEW_VOLUME (gate específico). */
const VOLUME_REFS: ReadonlySet<AppliedRef> = new Set<AppliedRef>(["volume"]);
import { applyWritePort } from "@/lib/infra/proposal/apply";
import { applyCatalogProposal } from "@/lib/contributions/mutations/applyCatalogProposal";
import { applyCatalogProposalAction } from "@/app/contribuciones/actions";
import { isEnabled } from "@/lib/featureFlags";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { applyCatalogProposalUseCase } from "@/lib/contributions/applyCatalogProposal";

vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), requireUserId: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: vi.fn(), RL: {} }));
vi.mock("@/lib/contributions/applyCatalogProposal", async (orig) => {
  const actual = await orig<typeof import("@/lib/contributions/applyCatalogProposal")>();
  return { ...actual, applyCatalogProposalUseCase: vi.fn() };
});

const ADMIN = "admin-1";
// `claimOperation` default "SET" → los fixtures Creation existentes lo heredan sin cambio
// (Creation lo ignora); los tests Mutation lo pasan explícito.
const claim = (attributeKind: string, value: unknown, id = 1, result = "ACEPTADA", claimOperation = "SET"): ApplyClaimRow =>
  ({ id, attributeKind, value, claimOperation, result });
const titleEs = (text = "Naruto", id = 11) => claim("TITLE_LOCALIZED", { language: "es", text }, id);

// ---------------------------------------------------------------------------
// Dominio y mapping
// ---------------------------------------------------------------------------
describe("dominio — buildApplySeed + gate", () => {
  it("buildApplySeed valida proposalId y idempotencyKey", () => {
    expect(() => buildApplySeed({ proposalId: "0", idempotencyKey: "k" })).toThrow(ValidationError);
    expect(() => buildApplySeed({ proposalId: "5", idempotencyKey: "  " })).toThrow(ValidationError);
    expect(buildApplySeed({ proposalId: "5", idempotencyKey: "k1" })).toEqual({ proposalId: 5, idempotencyKey: "k1" });
  });

  const rr = (o: Partial<ExistingResolutionForApply> = {}): ExistingResolutionForApply =>
    ({ id: 42, outcome: "ACEPTADA", mutationCorrelationId: null, appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null, ...o });

  // Equivalencia EXACTA del gate previo de NEW_WORK usando refs esperadas {work}.
  it("classifyApplyState (expected={work}): NOT_APPLIED / APPLIED / INCONSISTENT", () => {
    expect(classifyApplyState(rr(), WORK_REFS)).toBe("NOT_APPLIED"); // todos null
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedWorkId: 7 }), WORK_REFS)).toBe("APPLIED"); // corr + work
    expect(classifyApplyState(rr({ mutationCorrelationId: "c" }), WORK_REFS)).toBe("INCONSISTENT"); // corr sin work
    expect(classifyApplyState(rr({ appliedWorkId: 7 }), WORK_REFS)).toBe("INCONSISTENT"); // work sin corr
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedWorkId: 7, appliedEditionId: 9 }), WORK_REFS)).toBe("INCONSISTENT"); // edition inesperada
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedWorkId: 7, appliedVolumeId: 9 }), WORK_REFS)).toBe("INCONSISTENT"); // volume inesperado
  });

  it("classifyApplyState: ref esperada faltante y ref inesperada sola → INCONSISTENT", () => {
    // esperaba work pero solo hay edition (inesperada, y falta la esperada)
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedEditionId: 9 }), WORK_REFS)).toBe("INCONSISTENT");
    // correlation + solo volume
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedVolumeId: 9 }), WORK_REFS)).toBe("INCONSISTENT");
  });

  it("política de proyección WORK: exhaustiva y disjunta sobre todos los kinds WORK-level", () => {
    const workKinds = Object.entries(ATTRIBUTE_KIND_LEVEL)
      .filter(([, lvl]) => lvl === "WORK")
      .map(([k]) => k);
    // cada kind WORK-level está en EXACTAMENTE uno de los dos conjuntos
    for (const k of workKinds) {
      const inMat = WORK_MATERIALIZED_KINDS.has(k);
      const inNot = WORK_ACCEPTED_NOT_MATERIALIZED_KINDS.has(k);
      expect(inMat !== inNot).toBe(true);
    }
    // los conjuntos no contienen kinds ajenos a WORK-level
    const union = new Set([...WORK_MATERIALIZED_KINDS, ...WORK_ACCEPTED_NOT_MATERIALIZED_KINDS]);
    expect(union).toEqual(new Set(workKinds));
  });

  // Gate NEW_EDITION explícito (expected={edition}), sin reusar los casos de NEW_WORK.
  it("gate NEW_EDITION: correlation + appliedEditionId (resto null) ⇒ APPLIED", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedEditionId: 9 }), EDITION_REFS)).toBe("APPLIED");
  });

  it("gate NEW_EDITION: correlation presente + appliedEditionId ausente ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c" }), EDITION_REFS)).toBe("INCONSISTENT");
  });

  it("gate NEW_EDITION: appliedEditionId presente + correlation ausente ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ appliedEditionId: 9 }), EDITION_REFS)).toBe("INCONSISTENT");
  });

  it("gate NEW_EDITION: appliedVolumeId presente ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedEditionId: 9, appliedVolumeId: 7 }), EDITION_REFS)).toBe("INCONSISTENT");
  });

  // Gate NEW_VOLUME explícito (expected={volume}).
  it("gate NEW_VOLUME: correlation + appliedVolumeId (resto null) ⇒ APPLIED", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedVolumeId: 9 }), VOLUME_REFS)).toBe("APPLIED");
  });

  it("gate NEW_VOLUME: correlation sin appliedVolumeId ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c" }), VOLUME_REFS)).toBe("INCONSISTENT");
  });

  it("gate NEW_VOLUME: appliedVolumeId sin correlation ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ appliedVolumeId: 9 }), VOLUME_REFS)).toBe("INCONSISTENT");
  });

  it("gate NEW_VOLUME: appliedWorkId inesperado ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedVolumeId: 9, appliedWorkId: 1 }), VOLUME_REFS)).toBe("INCONSISTENT");
  });

  it("gate NEW_VOLUME: appliedEditionId inesperado ⇒ INCONSISTENT", () => {
    expect(classifyApplyState(rr({ mutationCorrelationId: "c", appliedVolumeId: 9, appliedEditionId: 1 }), VOLUME_REFS)).toBe("INCONSISTENT");
  });
});

describe("dominio — buildWorkDraft (mapping cerrado NEW_WORK)", () => {
  it("exige al menos una claim aceptada", () => {
    expect(() => buildWorkDraft([], "MANGA")).toThrow(NoApplicableClaimsError);
  });

  it("exige una claim de título aplicable", () => {
    expect(() => buildWorkDraft([claim("WORK_TYPE", "MANGA")], "MANGA")).toThrow(NoApplicableClaimsError);
  });

  it("título primario: prioridad es-AR > es > en > romaji > native", () => {
    const d1 = buildWorkDraft([
      claim("TITLE_LOCALIZED", { language: "es-AR", text: "AR" }, 1),
      claim("TITLE_LOCALIZED", { language: "es", text: "ES" }, 2),
      claim("TITLE_LOCALIZED", { language: "en", text: "EN" }, 3),
    ], "MANGA");
    expect(d1.title).toBe("AR");
    expect(d1.primaryTitleClaimId).toBe(1);
    expect(buildWorkDraft([claim("TITLE_LOCALIZED", { language: "es", text: "ES" }, 2), claim("TITLE_LOCALIZED", { language: "en", text: "EN" }, 3)], "MANGA").title).toBe("ES");
    expect(buildWorkDraft([claim("TITLE_LOCALIZED", { language: "en", text: "EN" }, 3)], "MANGA").title).toBe("EN");
    expect(buildWorkDraft([claim("TITLE_ROMAJI", "Romaji", 4)], "MANGA").title).toBe("Romaji");
    const dn = buildWorkDraft([claim("TITLE_NATIVE", { language: "ja", text: "ナルト" }, 5)], "MANGA");
    expect(dn.title).toBe("ナルト");
    expect(dn.primaryTitleClaimId).toBe(5);
  });

  it("mapea TITLE_ROMAJI→originalTitle, TITLE_NATIVE→titleNative, TITLE_LOCALIZED en→titleEn", () => {
    const d = buildWorkDraft([
      titleEs("Naruto", 1),
      claim("TITLE_ROMAJI", "Naruto", 2),
      claim("TITLE_NATIVE", { language: "ja", text: "ナルト" }, 3),
      claim("TITLE_LOCALIZED", { language: "en", text: "Naruto EN" }, 4),
    ], "MANGA");
    expect(d.originalTitle).toBe("Naruto");
    expect(d.titleNative).toBe("ナルト");
    expect(d.titleEn).toBe("Naruto EN");
  });

  it("mapea WORK_TYPE (acotado a contentClass) y hace fallback por contentClass", () => {
    expect(buildWorkDraft([titleEs(), claim("WORK_TYPE", "LIGHT_NOVEL", 2)], "MANGA").type).toBe("LIGHT_NOVEL");
    expect(buildWorkDraft([titleEs(), claim("WORK_TYPE", "OTHER_MANGA", 2)], "MANGA").type).toBe("OTHER");
    expect(buildWorkDraft([titleEs()], "MANGA").type).toBe("MANGA");
    expect(buildWorkDraft([titleEs()], "COMIC").type).toBe("COMIC");
    // incoherente con contentClass
    expect(() => buildWorkDraft([titleEs(), claim("WORK_TYPE", "COMIC", 2)], "MANGA")).toThrow(ClaimSetInvalidError);
  });

  it("mapea CREATOR_CREDIT STORY con menor order → author", () => {
    const d = buildWorkDraft([
      titleEs(),
      claim("CREATOR_CREDIT", { displayName: "Autor B", role: "STORY", order: 2 }, 2),
      claim("CREATOR_CREDIT", { displayName: "Autor A", role: "STORY", order: 1 }, 3),
      claim("CREATOR_CREDIT", { displayName: "Dibujante", role: "ART", order: 1 }, 4),
    ], "MANGA");
    expect(d.author).toBe("Autor A");
  });

  it("mapea SYNOPSIS_LOCALIZED por idioma y EXTERNAL_WORK_ID por provider", () => {
    const d = buildWorkDraft([
      titleEs(),
      claim("SYNOPSIS_LOCALIZED", { language: "es", text: "Sinopsis ES" }, 2),
      claim("SYNOPSIS_LOCALIZED", { language: "en", text: "Synopsis EN" }, 3),
      claim("EXTERNAL_WORK_ID", { provider: "AniList", externalId: "123" }, 4),
      claim("EXTERNAL_WORK_ID", { provider: "MangaUpdates", externalId: "mu-9" }, 5),
      claim("EXTERNAL_WORK_ID", { provider: "MangaDex", externalId: "md-uuid" }, 6),
    ], "MANGA");
    expect(d.synopsisEs).toBe("Sinopsis ES");
    expect(d.synopsisEn).toBe("Synopsis EN");
    expect(d.anilistId).toBe(123);
    expect(d.muId).toBe("mu-9");
    expect(d.mdId).toBe("md-uuid");
  });

  it("curated contiene solo campos realmente aplicados", () => {
    const d = buildWorkDraft([titleEs("Naruto", 1), claim("TITLE_ROMAJI", "Naruto", 2)], "MANGA");
    expect(d.curated).toContain("title");
    expect(d.curated).toContain("originalTitle");
    expect(d.curated).not.toContain("author");
    expect(d.curated).not.toContain("muId");
  });

  it("cardinalidad: singular duplicada y colisión de sub-clave", () => {
    expect(() => buildWorkDraft([titleEs(), claim("WORK_TYPE", "MANGA", 2), claim("WORK_TYPE", "ARTBOOK", 3)], "MANGA")).toThrow(ClaimSetInvalidError);
    expect(() => buildWorkDraft([claim("TITLE_LOCALIZED", { language: "es", text: "A" }, 1), claim("TITLE_LOCALIZED", { language: "es", text: "B" }, 2)], "MANGA")).toThrow(ClaimSetInvalidError);
  });

  it("claim de nivel EDITION en NEW_WORK falla (incompatibilidad de nivel)", () => {
    expect(() => buildWorkDraft([titleEs(), claim("EDITION_PUBLISHER", "Ivrea", 2)], "MANGA")).toThrow(UnsupportedClaimForApplyError);
  });

  it("kind desconocido no se ignora en silencio → error duro", () => {
    expect(() => buildWorkDraft([titleEs(), claim("TOTALLY_UNKNOWN_KIND", "x", 2)], "MANGA")).toThrow(UnsupportedClaimForApplyError);
  });

  it("claim WORK válida NO materializada (ORIGINAL_LANGUAGE) no bloquea, no se proyecta ni entra a curated", () => {
    const d = buildWorkDraft([titleEs("Naruto", 1), claim("ORIGINAL_LANGUAGE", "ja", 2)], "MANGA");
    expect(d.title).toBe("Naruto");
    // no hay campo original_language en el draft; curated solo trae lo materializado
    expect(d.curated).toEqual(["title"]);
    expect(d.curated).not.toContain("originalLanguage");
  });

  it("otras claims WORK no materializadas tampoco bloquean (COUNTRY_OF_ORIGIN, WORK_STATUS, START_DATE, END_DATE, TITLE_ALTERNATIVE)", () => {
    const d = buildWorkDraft([
      titleEs("Naruto", 1),
      claim("COUNTRY_OF_ORIGIN", "JP", 2),
      claim("WORK_STATUS", "COMPLETED", 3),
      claim("START_DATE", { year: 1999 }, 4),
      claim("END_DATE", { year: 2014 }, 5),
      claim("TITLE_ALTERNATIVE", { text: "ナルト" }, 6),
    ], "MANGA");
    expect(d.title).toBe("Naruto");
    expect(d.curated).toEqual(["title"]);
  });
});

// ---------------------------------------------------------------------------
// Dominio — buildEditionDraft + slug + política EDITION (NEW_EDITION)
// ---------------------------------------------------------------------------
describe("dominio — buildEditionDraft (mapping cerrado NEW_EDITION)", () => {
  const edBase = (): ApplyClaimRow[] => [
    claim("EDITION_PUBLISHER", "Ivrea Argentina", 21),
    claim("EDITION_LANGUAGE", "es", 22),
    claim("EDITION_COUNTRY", "AR", 23),
  ];

  it("communityEditionSlug es determinista", () => {
    expect(communityEditionSlug(123, "es")).toBe("cc:w123:es");
    expect(communityEditionSlug(7, "en")).toBe("cc:w7:en");
  });

  it("mapea materializadas (publisher/country/language/status/volumes/whakoomId) + title/workId del padre", () => {
    const d = buildEditionDraft([
      ...edBase(),
      claim("EDITION_STATUS", "ONGOING", 24),
      claim("EDITION_ANNOUNCED_TOTAL_VOLUMES", 5, 25),
      claim("EXTERNAL_EDITION_ID", { provider: "Whakoom", externalId: "wk-1" }, 26),
    ], "Naruto", 123);
    expect(d).toEqual({
      publisher: "Ivrea Argentina", language: "es", country: "AR", status: "ONGOING",
      volumes: 5, volumesLocked: true, whakoomId: "wk-1", title: "Naruto", workId: 123,
    });
  });

  it("volumes=0 / volumesLocked=false sin claim de cantidad; con claim → volumesLocked=true", () => {
    const d0 = buildEditionDraft(edBase(), "Naruto", 123);
    expect(d0.volumes).toBe(0);
    expect(d0.volumesLocked).toBe(false);
    const d1 = buildEditionDraft([...edBase(), claim("EDITION_ANNOUNCED_TOTAL_VOLUMES", 12, 24)], "Naruto", 123);
    expect(d1.volumes).toBe(12);
    expect(d1.volumesLocked).toBe(true);
  });

  it("EDITION_ANNOUNCED_TOTAL_VOLUMES = 0 (claim presente) → volumes 0 pero volumesLocked true (la presencia importa, no el valor)", () => {
    const d = buildEditionDraft([...edBase(), claim("EDITION_ANNOUNCED_TOTAL_VOLUMES", 0, 24)], "Naruto", 123);
    expect(d.volumes).toBe(0);
    expect(d.volumesLocked).toBe(true);
  });

  it("claims EDITION no materializadas no bloquean (FORMAT/LABEL/RELEASE_DATE/IS_UPCOMING)", () => {
    const d = buildEditionDraft([
      ...edBase(),
      claim("EDITION_FORMAT", "SINGLES", 24),
      claim("EDITION_LABEL_OR_IMPRINT", "Deluxe", 25),
      claim("EDITION_RELEASE_DATE", { year: 2020 }, 26),
      claim("EDITION_IS_UPCOMING", true, 27),
    ], "Naruto", 123);
    expect(d.publisher).toBe("Ivrea Argentina");
    expect(d.country).toBe("AR");
  });

  it("exige el set materializado hard (publisher, language, country)", () => {
    expect(() => buildEditionDraft([claim("EDITION_LANGUAGE", "es", 22), claim("EDITION_COUNTRY", "AR", 23)], "Naruto", 123)).toThrow(InsufficientCatalogDataError);
    expect(() => buildEditionDraft([claim("EDITION_PUBLISHER", "Ivrea", 21), claim("EDITION_COUNTRY", "AR", 23)], "Naruto", 123)).toThrow(InsufficientCatalogDataError);
    expect(() => buildEditionDraft([claim("EDITION_PUBLISHER", "Ivrea", 21), claim("EDITION_LANGUAGE", "es", 22)], "Naruto", 123)).toThrow(InsufficientCatalogDataError);
  });

  it("cardinalidad: singular duplicada y colisión de sub-clave (provider)", () => {
    expect(() => buildEditionDraft([...edBase(), claim("EDITION_PUBLISHER", "Otra", 24)], "Naruto", 123)).toThrow(ClaimSetInvalidError);
    expect(() => buildEditionDraft([
      ...edBase(),
      claim("EXTERNAL_EDITION_ID", { provider: "Whakoom", externalId: "a" }, 24),
      claim("EXTERNAL_EDITION_ID", { provider: "Whakoom", externalId: "b" }, 25),
    ], "Naruto", 123)).toThrow(ClaimSetInvalidError);
  });

  it("claim de nivel WORK o VOLUME en NEW_EDITION falla; kind desconocido también", () => {
    expect(() => buildEditionDraft([...edBase(), claim("TITLE_LOCALIZED", { language: "es", text: "x" }, 24)], "Naruto", 123)).toThrow(UnsupportedClaimForApplyError);
    expect(() => buildEditionDraft([...edBase(), claim("VOLUME_NUMBER", 1, 24)], "Naruto", 123)).toThrow(UnsupportedClaimForApplyError);
    expect(() => buildEditionDraft([...edBase(), claim("TOTALLY_UNKNOWN", 1, 24)], "Naruto", 123)).toThrow(UnsupportedClaimForApplyError);
  });

  it("política de proyección EDITION: exhaustiva y disjunta sobre todos los kinds EDITION-level", () => {
    const editionKinds = Object.entries(ATTRIBUTE_KIND_LEVEL)
      .filter(([, lvl]) => lvl === "EDITION")
      .map(([k]) => k);
    for (const k of editionKinds) {
      const inMat = EDITION_MATERIALIZED_KINDS.has(k);
      const inNot = EDITION_ACCEPTED_NOT_MATERIALIZED_KINDS.has(k);
      expect(inMat !== inNot).toBe(true);
    }
    const union = new Set([...EDITION_MATERIALIZED_KINDS, ...EDITION_ACCEPTED_NOT_MATERIALIZED_KINDS]);
    expect(union).toEqual(new Set(editionKinds));
  });
});

// ---------------------------------------------------------------------------
// Dominio — buildVolumeDraft + política VOLUME (NEW_VOLUME)
// ---------------------------------------------------------------------------
describe("dominio — buildVolumeDraft (mapping cerrado NEW_VOLUME)", () => {
  const num = (n: unknown, id = 31) => claim("VOLUME_NUMBER", n, id);

  it("política de proyección VOLUME: exhaustiva y disjunta sobre todos los kinds VOLUME-level", () => {
    const volumeKinds = Object.entries(ATTRIBUTE_KIND_LEVEL)
      .filter(([, lvl]) => lvl === "VOLUME")
      .map(([k]) => k);
    for (const k of volumeKinds) {
      const inMat = VOLUME_MATERIALIZED_KINDS.has(k);
      const inNot = VOLUME_ACCEPTED_NOT_MATERIALIZED_KINDS.has(k);
      expect(inMat !== inNot).toBe(true);
    }
    const union = new Set([...VOLUME_MATERIALIZED_KINDS, ...VOLUME_ACCEPTED_NOT_MATERIALIZED_KINDS]);
    expect(union).toEqual(new Set(volumeKinds));
  });

  it("happy mínimo: solo VOLUME_NUMBER", () => {
    expect(buildVolumeDraft([num(3)], 42)).toEqual({ editionId: 42, number: 3, isbn: null, whakoomComicId: null });
  });

  it("happy completo: número + ISBN + external (Whakoom)", () => {
    const d = buildVolumeDraft([
      num(3),
      claim("VOLUME_ISBN", "978-987-1234-56-7", 32),
      claim("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "wc-9" }, 33),
    ], 42);
    expect(d).toEqual({ editionId: 42, number: 3, isbn: "978-987-1234-56-7", whakoomComicId: "wc-9" });
  });

  it("claims VOLUME no materializadas no bloquean (TITLE/RELEASE_DATE/PAGE_COUNT/STATUS/COVER)", () => {
    const d = buildVolumeDraft([
      num(1),
      claim("VOLUME_TITLE", { text: "Tomo 1" }, 32),
      claim("VOLUME_RELEASE_DATE", { year: 2020 }, 33),
      claim("VOLUME_PAGE_COUNT", 200, 34),
      claim("VOLUME_STATUS", "PUBLISHED", 35),
      claim("VOLUME_COVER", { face: "front", imageRef: "x" }, 36),
    ], 42);
    expect(d).toEqual({ editionId: 42, number: 1, isbn: null, whakoomComicId: null });
  });

  it("VOLUME_NUMBER: 0 y 1 válidos; negativo/decimal/NaN/Infinity/no-numérico fallan", () => {
    expect(buildVolumeDraft([num(0)], 42).number).toBe(0);
    expect(buildVolumeDraft([num(1)], 42).number).toBe(1);
    expect(() => buildVolumeDraft([num(-1)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(0.5)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(1.5)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(NaN)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(Infinity)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num("3")], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num({ foo: 1 })], 42)).toThrow(ClaimSetInvalidError);
  });

  it("VOLUME_NUMBER duplicado → ClaimSetInvalidError", () => {
    expect(() => buildVolumeDraft([num(1, 31), num(2, 32)], 42)).toThrow(ClaimSetInvalidError);
  });

  it("VOLUME_ISBN: ausente→null; trim; vacío/solo-espacios→error; duplicado→error", () => {
    expect(buildVolumeDraft([num(1)], 42).isbn).toBeNull();
    expect(buildVolumeDraft([num(1), claim("VOLUME_ISBN", "  978-1  ", 32)], 42).isbn).toBe("978-1");
    expect(() => buildVolumeDraft([num(1), claim("VOLUME_ISBN", "", 32)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(1), claim("VOLUME_ISBN", "   ", 32)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(1), claim("VOLUME_ISBN", "a", 32), claim("VOLUME_ISBN", "b", 33)], 42)).toThrow(ClaimSetInvalidError);
  });

  it("EXTERNAL_VOLUME_ID: Whakoom válido/trim; vacío→error; provider no soportado→error; duplicado→error", () => {
    expect(buildVolumeDraft([num(1), claim("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "  wc-1  " }, 32)], 42).whakoomComicId).toBe("wc-1");
    expect(() => buildVolumeDraft([num(1), claim("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "   " }, 32)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(1), claim("EXTERNAL_VOLUME_ID", { provider: "MangaDex", externalId: "x" }, 32)], 42)).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumeDraft([num(1), claim("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "a" }, 32), claim("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "b" }, 33)], 42)).toThrow(ClaimSetInvalidError);
  });

  it("nivel WORK/EDITION en NEW_VOLUME falla; kind desconocido también", () => {
    expect(() => buildVolumeDraft([num(1), claim("TITLE_LOCALIZED", { language: "es", text: "x" }, 32)], 42)).toThrow(UnsupportedClaimForApplyError);
    expect(() => buildVolumeDraft([num(1), claim("EDITION_PUBLISHER", "Ivrea", 32)], 42)).toThrow(UnsupportedClaimForApplyError);
    expect(() => buildVolumeDraft([num(1), claim("TOTALLY_UNKNOWN", 1, 32)], 42)).toThrow(UnsupportedClaimForApplyError);
  });

  it("precedencia: 0 claims → NoApplicableClaimsError; claims sin VOLUME_NUMBER → InsufficientCatalogDataError", () => {
    expect(() => buildVolumeDraft([], 42)).toThrow(NoApplicableClaimsError);
    // solo VOLUME_TITLE (aceptada, no materializada) → hay claim VOLUME pero falta el número
    expect(() => buildVolumeDraft([claim("VOLUME_TITLE", { text: "Tomo 1" }, 31)], 42)).toThrow(InsufficientCatalogDataError);
    // ISBN presente pero sin número
    expect(() => buildVolumeDraft([claim("VOLUME_ISBN", "978-1", 31)], 42)).toThrow(InsufficientCatalogDataError);
  });
});

// ---------------------------------------------------------------------------
// Dominio — buildVolumePatch (Mutation × Volume; ADR-007, familia Mutation)
// ---------------------------------------------------------------------------
describe("dominio — buildVolumePatch (patch parcial, honra claimOperation)", () => {
  // helper: claim VOLUME_* con operación explícita (5º arg del helper `claim`)
  const cop = (kind: string, value: unknown, op: string, id = 31) => claim(kind, value, id, "ACEPTADA", op);

  it("patch vacío: sin claims → {}; solo no-materializada (VOLUME_TITLE) → {}", () => {
    // ausencia ≠ null: un patch vacío es un no-op legítimo (no lanza, no fuerza columnas)
    expect(buildVolumePatch([])).toEqual({});
    expect(buildVolumePatch([claim("VOLUME_TITLE", { text: "Tomo 1" }, 31)])).toEqual({});
  });

  it("SET escalares: number / isbn / external se afirman por separado", () => {
    expect(buildVolumePatch([cop("VOLUME_NUMBER", 7, "SET")])).toEqual({ number: 7 });
    expect(buildVolumePatch([cop("VOLUME_NUMBER", 0, "SET")])).toEqual({ number: 0 });
    expect(buildVolumePatch([cop("VOLUME_ISBN", "  978-1  ", "SET")])).toEqual({ isbn: "978-1" });
    expect(buildVolumePatch([cop("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "  wc-9  " }, "SET")])).toEqual({ whakoomComicId: "wc-9" });
  });

  it("patch parcial: solo aparecen las columnas tocadas (ausencia ≠ null)", () => {
    // número + isbn tocados; whakoomComicId AUSENTE (no la clave con null): no se toca
    const p = buildVolumePatch([cop("VOLUME_NUMBER", 4, "SET", 31), cop("VOLUME_ISBN", "978-2", "SET", 32)]);
    expect(p).toEqual({ number: 4, isbn: "978-2" });
    expect("whakoomComicId" in p).toBe(false);
  });

  it("ERASE (REMOVE / MARK_UNKNOWN / MARK_NOT_APPLICABLE) en columnas nullable → null", () => {
    for (const op of ["REMOVE", "MARK_UNKNOWN", "MARK_NOT_APPLICABLE"]) {
      expect(buildVolumePatch([cop("VOLUME_ISBN", null, op)])).toEqual({ isbn: null });
      expect(buildVolumePatch([cop("EXTERNAL_VOLUME_ID", null, op)])).toEqual({ whakoomComicId: null });
    }
  });

  it("ADD sobre slot único Whakoom (EXTERNAL_VOLUME_ID) se comporta como SET (fijar)", () => {
    expect(buildVolumePatch([cop("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "wc-1" }, "ADD")])).toEqual({ whakoomComicId: "wc-1" });
  });

  it("ADD sobre escalares (VOLUME_NUMBER / VOLUME_ISBN) → rechazo explícito", () => {
    expect(() => buildVolumePatch([cop("VOLUME_NUMBER", 3, "ADD")])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([cop("VOLUME_ISBN", "978-1", "ADD")])).toThrow(ClaimSetInvalidError);
  });

  it("VOLUME_NUMBER (columna obligatoria) NO admite vaciado: REMOVE/MARK_* → error", () => {
    for (const op of ["REMOVE", "MARK_UNKNOWN", "MARK_NOT_APPLICABLE"]) {
      expect(() => buildVolumePatch([cop("VOLUME_NUMBER", null, op)])).toThrow(ClaimSetInvalidError);
    }
  });

  it("SET inválido: number no entero≥0 / isbn vacío / external malformado → error", () => {
    expect(() => buildVolumePatch([cop("VOLUME_NUMBER", -1, "SET")])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([cop("VOLUME_NUMBER", 1.5, "SET")])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([cop("VOLUME_NUMBER", "3", "SET")])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([cop("VOLUME_ISBN", "   ", "SET")])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([cop("EXTERNAL_VOLUME_ID", { provider: "MangaDex", externalId: "x" }, "SET")])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([cop("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "   " }, "SET")])).toThrow(ClaimSetInvalidError);
  });

  it("cardinalidad: número duplicado / external mismo provider duplicado → error", () => {
    expect(() => buildVolumePatch([cop("VOLUME_NUMBER", 1, "SET", 31), cop("VOLUME_NUMBER", 2, "SET", 32)])).toThrow(ClaimSetInvalidError);
    expect(() => buildVolumePatch([
      cop("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "a" }, "SET", 31),
      cop("EXTERNAL_VOLUME_ID", { provider: "Whakoom", externalId: "b" }, "SET", 32),
    ])).toThrow(ClaimSetInvalidError);
  });

  it("nivel WORK/EDITION o kind desconocido → UnsupportedClaimForApplyError", () => {
    expect(() => buildVolumePatch([claim("TITLE_LOCALIZED", { language: "es", text: "x" }, 31)])).toThrow(UnsupportedClaimForApplyError);
    expect(() => buildVolumePatch([claim("EDITION_PUBLISHER", "Ivrea", 31)])).toThrow(UnsupportedClaimForApplyError);
    expect(() => buildVolumePatch([claim("TOTALLY_UNKNOWN", 1, 31)])).toThrow(UnsupportedClaimForApplyError);
  });
});

// ---------------------------------------------------------------------------
// Infra write-port (tx falsa)
// ---------------------------------------------------------------------------
type FakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  resolutionRecord: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  proposalClaim: { findMany: ReturnType<typeof vi.fn> };
  work: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};
function fakeTx(over: Partial<{
  locked: unknown[]; resolution: unknown; claims: unknown[]; workUnique: unknown; workMany: unknown[]; create: ReturnType<typeof vi.fn>;
}> = {}): FakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "ACEPTADA", targetKind: "NEW_WORK", contentClass: "MANGA", version: 2 }]),
    resolutionRecord: {
      findUnique: vi.fn().mockResolvedValue(over.resolution === undefined
        ? { id: 42, outcome: "ACEPTADA", mutationCorrelationId: null, appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null }
        : over.resolution),
      update: vi.fn().mockResolvedValue({}),
    },
    proposalClaim: { findMany: vi.fn().mockResolvedValue(over.claims ?? [{ id: 11, attributeKind: "TITLE_LOCALIZED", value: { language: "es", text: "Naruto" }, result: "ACEPTADA" }]) },
    work: {
      findUnique: vi.fn().mockResolvedValue(over.workUnique ?? null),
      findMany: vi.fn().mockResolvedValue(over.workMany ?? []),
      create: over.create ?? vi.fn().mockResolvedValue({ id: 777 }),
    },
  };
}
const runApply = (tx: FakeTx, onCommitted = vi.fn(), corr = "corr-1") =>
  applyWritePort(tx as unknown as Prisma.TransactionClient, onCommitted).apply({ proposalId: 5, idempotencyKey: "k1" }, corr);

describe("infra write-port — persistencia, gate, dedup, atomicidad", () => {
  it("lock de la propuesta primero; crea Work (upcoming) y update único del ResolutionRecord", async () => {
    const tx = fakeTx();
    const onCommitted = vi.fn();
    const out = await runApply(tx, onCommitted, "corr-9");
    // orden: lock antes que cualquier lectura/escritura
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.resolutionRecord.findUnique.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.work.create.mock.invocationCallOrder[0]);
    // create Work
    expect(tx.work.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "Naruto", normTitle: "naruto", type: "MANGA", upcoming: true }),
    }));
    // update único con applied refs + correlation + primaryTitle
    expect(tx.resolutionRecord.update).toHaveBeenCalledTimes(1);
    expect(tx.resolutionRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { proposalId: 5 },
      data: { appliedWorkId: 777, mutationCorrelationId: "corr-9", primaryTitleClaimId: 11 },
    }));
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_WORK", appliedWorkId: 777, appliedEditionId: null, appliedVolumeId: null, mutationCorrelationId: "corr-9", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
    // no toca la propuesta (sin catalogProposal en la tx) ni edition/volume
    expect(Object.keys(tx)).not.toContain("catalogProposal");
    expect(Object.keys(tx)).not.toContain("publisherEdition");
    expect(Object.keys(tx)).not.toContain("volume");
  });

  it("solo mapea claims ACEPTADA (ignora NO_USADA)", async () => {
    const tx = fakeTx({ claims: [
      { id: 11, attributeKind: "TITLE_LOCALIZED", value: { language: "es", text: "Naruto" }, result: "ACEPTADA" },
      { id: 12, attributeKind: "TITLE_ROMAJI", value: "Descartado", result: "NO_USADA" },
    ] });
    await runApply(tx);
    expect(tx.work.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ originalTitle: undefined }) }));
  });

  it("una claim WORK aceptada NO materializada (ORIGINAL_LANGUAGE) no bloquea: crea el Work igual", async () => {
    const tx = fakeTx({ claims: [
      { id: 11, attributeKind: "TITLE_LOCALIZED", value: { language: "es", text: "Naruto" }, result: "ACEPTADA" },
      { id: 12, attributeKind: "ORIGINAL_LANGUAGE", value: "ja", result: "ACEPTADA" },
    ] });
    const out = await runApply(tx, vi.fn(), "corr-nm");
    expect(tx.work.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "Naruto", curated: ["title"] }),
    }));
    expect(tx.resolutionRecord.update).toHaveBeenCalledTimes(1);
    expect(out.recovered).toBe(false);
  });

  it("rechaza si queda alguna claim PROPUESTA", async () => {
    const tx = fakeTx({ claims: [
      { id: 11, attributeKind: "TITLE_LOCALIZED", value: { language: "es", text: "Naruto" }, result: "ACEPTADA" },
      { id: 12, attributeKind: "WORK_TYPE", value: "MANGA", result: "PROPUESTA" },
    ] });
    await expect(runApply(tx)).rejects.toThrow(ClaimSetInvalidError);
    expect(tx.work.create).not.toHaveBeenCalled();
  });

  it("propuesta inexistente / targetKind no soportado / estado no ACEPTADA", async () => {
    await expect(runApply(fakeTx({ locked: [] }))).rejects.toThrow(ProposalNotFoundError);
    await expect(runApply(fakeTx({ locked: [{ id: 5, status: "ACEPTADA", targetKind: "STRUCTURAL", contentClass: "MANGA", version: 2 }] }))).rejects.toThrow(TargetKindNotSupportedError);
    await expect(runApply(fakeTx({ locked: [{ id: 5, status: "SUBMITTED", targetKind: "NEW_WORK", contentClass: "MANGA", version: 2 }] }))).rejects.toThrow(ProposalNotApplicableError);
  });

  it("resolución faltante / no positiva", async () => {
    await expect(runApply(fakeTx({ resolution: null }))).rejects.toThrow(ResolutionNotFoundError);
    await expect(runApply(fakeTx({ resolution: { id: 42, outcome: "RECHAZADA", mutationCorrelationId: null, appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null } }))).rejects.toThrow(ResolutionNotPositiveError);
  });

  it("replay consistente: recupera, NO crea Work ni actualiza ResolutionRecord", async () => {
    const tx = fakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "corr-old", appliedWorkId: 555, appliedEditionId: null, appliedVolumeId: null } });
    const out = await runApply(tx);
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_WORK", appliedWorkId: 555, appliedEditionId: null, appliedVolumeId: null, mutationCorrelationId: "corr-old", recovered: true });
    expect(tx.work.create).not.toHaveBeenCalled();
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("estado inconsistente → InconsistentApplyStateError (varias combinaciones)", async () => {
    await expect(runApply(fakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "c", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null } }))).rejects.toThrow(InconsistentApplyStateError);
    await expect(runApply(fakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: null, appliedWorkId: 5, appliedEditionId: null, appliedVolumeId: null } }))).rejects.toThrow(InconsistentApplyStateError);
    await expect(runApply(fakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "c", appliedWorkId: 5, appliedEditionId: 9, appliedVolumeId: null } }))).rejects.toThrow(InconsistentApplyStateError);
    await expect(runApply(fakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "c", appliedWorkId: 5, appliedEditionId: null, appliedVolumeId: 9 } }))).rejects.toThrow(InconsistentApplyStateError);
  });

  it("dedup por external ID → CatalogConflictError", async () => {
    const tx = fakeTx({
      claims: [
        { id: 11, attributeKind: "TITLE_LOCALIZED", value: { language: "es", text: "Naruto" }, result: "ACEPTADA" },
        { id: 12, attributeKind: "EXTERNAL_WORK_ID", value: { provider: "AniList", externalId: "20" }, result: "ACEPTADA" },
      ],
      workUnique: { id: 1 },
    });
    await expect(runApply(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.work.create).not.toHaveBeenCalled();
  });

  it("dedup por título + contentClass → CatalogConflictError", async () => {
    const tx = fakeTx({ workMany: [{ id: 1, title: "Naruto", type: "MANGA" }] });
    await expect(runApply(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.work.create).not.toHaveBeenCalled();
  });

  it("P2002 al crear el Work → CatalogConflictError, sin marcar Apply", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["Work_muId_key"] } });
    const tx = fakeTx({ create: vi.fn().mockRejectedValue(p2002) });
    await expect(runApply(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("fallo en create o update propaga y NO captura", async () => {
    const tx1 = fakeTx({ create: vi.fn().mockRejectedValue(new Error("boom")) });
    const onC1 = vi.fn();
    await expect(applyWritePort(tx1 as unknown as Prisma.TransactionClient, onC1).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("boom");
    expect(onC1).not.toHaveBeenCalled();

    const tx2 = fakeTx();
    tx2.resolutionRecord.update.mockRejectedValue(new Error("kaboom"));
    const onC2 = vi.fn();
    await expect(applyWritePort(tx2 as unknown as Prisma.TransactionClient, onC2).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("kaboom");
    expect(onC2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Infra write-port — NEW_EDITION (tx falsa edición-shaped)
// ---------------------------------------------------------------------------
type EditionFakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  resolutionRecord: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  proposalClaim: { findMany: ReturnType<typeof vi.fn> };
  work: { findUnique: ReturnType<typeof vi.fn> };
  publisherEdition: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};
function editionFakeTx(over: Partial<{
  locked: unknown[]; resolution: unknown; claims: unknown[]; parent: unknown; edUnique: unknown; create: ReturnType<typeof vi.fn>;
}> = {}): EditionFakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "ACEPTADA", targetKind: "NEW_EDITION", contentClass: "MANGA", version: 2, refWorkId: 123 }]),
    resolutionRecord: {
      findUnique: vi.fn().mockResolvedValue(over.resolution === undefined
        ? { id: 42, outcome: "ACEPTADA", mutationCorrelationId: null, appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null }
        : over.resolution),
      update: vi.fn().mockResolvedValue({}),
    },
    proposalClaim: { findMany: vi.fn().mockResolvedValue(over.claims ?? [
      { id: 21, attributeKind: "EDITION_PUBLISHER", value: "Ivrea Argentina", result: "ACEPTADA" },
      { id: 22, attributeKind: "EDITION_LANGUAGE", value: "es", result: "ACEPTADA" },
      { id: 23, attributeKind: "EDITION_COUNTRY", value: "AR", result: "ACEPTADA" },
    ]) },
    work: { findUnique: vi.fn().mockResolvedValue(over.parent === undefined ? { id: 123, title: "Naruto" } : over.parent) },
    publisherEdition: {
      findUnique: vi.fn().mockResolvedValue(over.edUnique ?? null),
      create: over.create ?? vi.fn().mockResolvedValue({ id: 888 }),
    },
  };
}
const runApplyEdition = (tx: EditionFakeTx, onCommitted = vi.fn(), corr = "corr-e") =>
  applyWritePort(tx as unknown as Prisma.TransactionClient, onCommitted).apply({ proposalId: 5, idempotencyKey: "k1" }, corr);

describe("infra write-port — NEW_EDITION", () => {
  it("happy path mínimo: crea PublisherEdition (slug/url) y update único del ResolutionRecord (appliedEditionId)", async () => {
    const tx = editionFakeTx();
    const onCommitted = vi.fn();
    const out = await runApplyEdition(tx, onCommitted, "corr-e1");
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.publisherEdition.create.mock.invocationCallOrder[0]);
    expect(tx.work.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 123 } })); // parent
    expect(tx.publisherEdition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        publisher: "Ivrea Argentina", slug: "cc:w123:es", title: "Naruto", normTitle: "naruto",
        url: "", language: "es", country: "AR", volumes: 0, volumesLocked: false, workId: 123,
      }),
    }));
    expect(tx.resolutionRecord.update).toHaveBeenCalledTimes(1);
    expect(tx.resolutionRecord.update).toHaveBeenCalledWith({
      where: { proposalId: 5 },
      data: { appliedEditionId: 888, mutationCorrelationId: "corr-e1" },
    });
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_EDITION", appliedWorkId: null, appliedEditionId: 888, appliedVolumeId: null, mutationCorrelationId: "corr-e1", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
  });

  it("happy path completo: status/volumes(locked)/whakoomId materializados", async () => {
    const tx = editionFakeTx({ claims: [
      { id: 21, attributeKind: "EDITION_PUBLISHER", value: "Ivrea Argentina", result: "ACEPTADA" },
      { id: 22, attributeKind: "EDITION_LANGUAGE", value: "es", result: "ACEPTADA" },
      { id: 23, attributeKind: "EDITION_COUNTRY", value: "AR", result: "ACEPTADA" },
      { id: 24, attributeKind: "EDITION_STATUS", value: "ONGOING", result: "ACEPTADA" },
      { id: 25, attributeKind: "EDITION_ANNOUNCED_TOTAL_VOLUMES", value: 12, result: "ACEPTADA" },
      { id: 26, attributeKind: "EXTERNAL_EDITION_ID", value: { provider: "Whakoom", externalId: "wk-9" }, result: "ACEPTADA" },
    ] });
    await runApplyEdition(tx);
    expect(tx.publisherEdition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ONGOING", volumes: 12, volumesLocked: true, whakoomId: "wk-9" }),
    }));
  });

  it("replay: recupera appliedEditionId, NO crea ni actualiza", async () => {
    const tx = editionFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "corr-old", appliedWorkId: null, appliedEditionId: 555, appliedVolumeId: null } });
    const out = await runApplyEdition(tx);
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_EDITION", appliedWorkId: null, appliedEditionId: 555, appliedVolumeId: null, mutationCorrelationId: "corr-old", recovered: true });
    expect(tx.publisherEdition.create).not.toHaveBeenCalled();
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("replay: retorna ANTES de cualquier lógica específica del target (no lee padre/claims, no dedup, no draft, no create, no update)", async () => {
    const tx = editionFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "corr-old", appliedWorkId: null, appliedEditionId: 555, appliedVolumeId: null } });
    const out = await runApplyEdition(tx);
    expect(out.recovered).toBe(true);
    expect(tx.work.findUnique).not.toHaveBeenCalled(); // no lee Work padre
    expect(tx.proposalClaim.findMany).not.toHaveBeenCalled(); // no lee claims ⇒ no construye EditionDraft
    expect(tx.publisherEdition.findUnique).not.toHaveBeenCalled(); // no ejecuta deduplicación
    expect(tx.publisherEdition.create).not.toHaveBeenCalled(); // no crea
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled(); // no actualiza ResolutionRecord
  });

  it("gate inconsistente para edición (appliedWorkId inesperado) → InconsistentApplyStateError", async () => {
    const tx = editionFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "c", appliedWorkId: 9, appliedEditionId: null, appliedVolumeId: null } });
    await expect(runApplyEdition(tx)).rejects.toThrow(InconsistentApplyStateError);
  });

  it("Work padre inexistente → ParentWorkNotFoundError (refWorkId null o fila ausente)", async () => {
    await expect(runApplyEdition(editionFakeTx({ locked: [{ id: 5, status: "ACEPTADA", targetKind: "NEW_EDITION", contentClass: "MANGA", version: 2, refWorkId: null }] }))).rejects.toThrow(ParentWorkNotFoundError);
    await expect(runApplyEdition(editionFakeTx({ parent: null }))).rejects.toThrow(ParentWorkNotFoundError);
  });

  it("falta un dato mínimo (country) → InsufficientCatalogDataError, sin create", async () => {
    const tx = editionFakeTx({ claims: [
      { id: 21, attributeKind: "EDITION_PUBLISHER", value: "Ivrea Argentina", result: "ACEPTADA" },
      { id: 22, attributeKind: "EDITION_LANGUAGE", value: "es", result: "ACEPTADA" },
    ] });
    await expect(runApplyEdition(tx)).rejects.toThrow(InsufficientCatalogDataError);
    expect(tx.publisherEdition.create).not.toHaveBeenCalled();
  });

  it("dedup por whakoomId → CatalogConflictError", async () => {
    const tx = editionFakeTx({
      claims: [
        { id: 21, attributeKind: "EDITION_PUBLISHER", value: "Ivrea Argentina", result: "ACEPTADA" },
        { id: 22, attributeKind: "EDITION_LANGUAGE", value: "es", result: "ACEPTADA" },
        { id: 23, attributeKind: "EDITION_COUNTRY", value: "AR", result: "ACEPTADA" },
        { id: 24, attributeKind: "EXTERNAL_EDITION_ID", value: { provider: "Whakoom", externalId: "wk-1" }, result: "ACEPTADA" },
      ],
      edUnique: { id: 1 },
    });
    await expect(runApplyEdition(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.publisherEdition.create).not.toHaveBeenCalled();
  });

  it("dedup por (publisher, slug) → CatalogConflictError", async () => {
    const tx = editionFakeTx({ edUnique: { id: 1 } }); // claims base sin whakoom → solo corre el check (publisher, slug)
    await expect(runApplyEdition(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.publisherEdition.create).not.toHaveBeenCalled();
  });

  it("P2002 al crear la edición → CatalogConflictError, sin marcar Apply", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["PublisherEdition_publisher_slug_key"] } });
    const tx = editionFakeTx({ create: vi.fn().mockRejectedValue(p2002) });
    await expect(runApplyEdition(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("rollback: fallo en create o update propaga y NO captura", async () => {
    const tx1 = editionFakeTx({ create: vi.fn().mockRejectedValue(new Error("boom")) });
    const onC1 = vi.fn();
    await expect(applyWritePort(tx1 as unknown as Prisma.TransactionClient, onC1).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("boom");
    expect(onC1).not.toHaveBeenCalled();

    const tx2 = editionFakeTx();
    tx2.resolutionRecord.update.mockRejectedValue(new Error("kaboom"));
    const onC2 = vi.fn();
    await expect(applyWritePort(tx2 as unknown as Prisma.TransactionClient, onC2).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("kaboom");
    expect(onC2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Infra write-port — NEW_VOLUME (tx falsa volumen-shaped)
// ---------------------------------------------------------------------------
type VolumeFakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  resolutionRecord: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  proposalClaim: { findMany: ReturnType<typeof vi.fn> };
  publisherEdition: { findUnique: ReturnType<typeof vi.fn> };
  volume: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};
function volumeFakeTx(over: Partial<{
  locked: unknown[]; resolution: unknown; claims: unknown[]; parent: unknown; volUnique: unknown; create: ReturnType<typeof vi.fn>;
}> = {}): VolumeFakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "ACEPTADA", targetKind: "NEW_VOLUME", contentClass: "MANGA", version: 2, refWorkId: null, refEditionId: 77 }]),
    resolutionRecord: {
      findUnique: vi.fn().mockResolvedValue(over.resolution === undefined
        ? { id: 42, outcome: "ACEPTADA", mutationCorrelationId: null, appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null }
        : over.resolution),
      update: vi.fn().mockResolvedValue({}),
    },
    proposalClaim: { findMany: vi.fn().mockResolvedValue(over.claims ?? [
      { id: 31, attributeKind: "VOLUME_NUMBER", value: 3, result: "ACEPTADA" },
    ]) },
    publisherEdition: { findUnique: vi.fn().mockResolvedValue(over.parent === undefined ? { id: 77 } : over.parent) },
    volume: {
      findUnique: vi.fn().mockResolvedValue(over.volUnique ?? null),
      create: over.create ?? vi.fn().mockResolvedValue({ id: 999 }),
    },
  };
}
const runApplyVolume = (tx: VolumeFakeTx, onCommitted = vi.fn(), corr = "corr-v") =>
  applyWritePort(tx as unknown as Prisma.TransactionClient, onCommitted).apply({ proposalId: 5, idempotencyKey: "k1" }, corr);

describe("infra write-port — NEW_VOLUME", () => {
  it("happy path: lee parent (mínimo), crea Volume (sin coverImage) y update único del RR (appliedVolumeId)", async () => {
    const tx = volumeFakeTx();
    const onCommitted = vi.fn();
    const out = await runApplyVolume(tx, onCommitted, "corr-v1");
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.volume.create.mock.invocationCallOrder[0]);
    // parent read exacto (solo id)
    expect(tx.publisherEdition.findUnique).toHaveBeenCalledWith({ where: { id: 77 }, select: { id: true } });
    // create exacto (editionId + number; opcionales `?? undefined`; SIN coverImage)
    expect(tx.volume.create).toHaveBeenCalledWith({
      data: { editionId: 77, number: 3, isbn: undefined, whakoomComicId: undefined },
      select: { id: true },
    });
    const createData = tx.volume.create.mock.calls[0][0].data;
    expect(createData).not.toHaveProperty("coverImage");
    // update exacto del RR
    expect(tx.resolutionRecord.update).toHaveBeenCalledTimes(1);
    expect(tx.resolutionRecord.update).toHaveBeenCalledWith({
      where: { proposalId: 5 },
      data: { appliedVolumeId: 999, mutationCorrelationId: "corr-v1" },
    });
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 999, mutationCorrelationId: "corr-v1", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
  });

  it("happy completo: isbn + whakoomComicId materializados", async () => {
    const tx = volumeFakeTx({ claims: [
      { id: 31, attributeKind: "VOLUME_NUMBER", value: 3, result: "ACEPTADA" },
      { id: 32, attributeKind: "VOLUME_ISBN", value: "978-1", result: "ACEPTADA" },
      { id: 33, attributeKind: "EXTERNAL_VOLUME_ID", value: { provider: "Whakoom", externalId: "wc-9" }, result: "ACEPTADA" },
    ] });
    await runApplyVolume(tx);
    expect(tx.volume.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { editionId: 77, number: 3, isbn: "978-1", whakoomComicId: "wc-9" },
    }));
  });

  it("dedup por (editionId, number); NO consulta por ISBN ni whakoomComicId", async () => {
    const tx = volumeFakeTx({ volUnique: { id: 1 } });
    await expect(runApplyVolume(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.volume.create).not.toHaveBeenCalled();
    // el único findUnique de volume es por editionId_number
    expect(tx.volume.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.volume.findUnique).toHaveBeenCalledWith({ where: { editionId_number: { editionId: 77, number: 3 } }, select: { id: true } });
  });

  it("edición padre inexistente → ParentEditionNotFoundError (refEditionId null o fila ausente), sin create", async () => {
    const tx1 = volumeFakeTx({ locked: [{ id: 5, status: "ACEPTADA", targetKind: "NEW_VOLUME", contentClass: "MANGA", version: 2, refWorkId: null, refEditionId: null }] });
    await expect(runApplyVolume(tx1)).rejects.toThrow(ParentEditionNotFoundError);
    const tx2 = volumeFakeTx({ parent: null });
    await expect(runApplyVolume(tx2)).rejects.toThrow(ParentEditionNotFoundError);
    expect(tx2.volume.create).not.toHaveBeenCalled();
  });

  it("falta VOLUME_NUMBER → InsufficientCatalogDataError, sin create", async () => {
    const tx = volumeFakeTx({ claims: [{ id: 31, attributeKind: "VOLUME_ISBN", value: "978-1", result: "ACEPTADA" }] });
    await expect(runApplyVolume(tx)).rejects.toThrow(InsufficientCatalogDataError);
    expect(tx.volume.create).not.toHaveBeenCalled();
  });

  it("P2002 al crear el Volume → CatalogConflictError, sin marcar Apply", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["Volume_editionId_number_key"] } });
    const tx = volumeFakeTx({ create: vi.fn().mockRejectedValue(p2002) });
    await expect(runApplyVolume(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("error ≠ P2002 (p.ej. FK/P2003) se propaga sin convertir; rollback (onCommitted no llamado)", async () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "6.19.3", meta: { field_name: "editionId" } });
    const tx = volumeFakeTx({ create: vi.fn().mockRejectedValue(p2003) });
    const onC = vi.fn();
    await expect(applyWritePort(tx as unknown as Prisma.TransactionClient, onC).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    expect(onC).not.toHaveBeenCalled();
  });

  it("rollback: fallo en create o en update del RR propaga y NO captura", async () => {
    const tx1 = volumeFakeTx({ create: vi.fn().mockRejectedValue(new Error("boom")) });
    const onC1 = vi.fn();
    await expect(applyWritePort(tx1 as unknown as Prisma.TransactionClient, onC1).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("boom");
    expect(onC1).not.toHaveBeenCalled();

    const tx2 = volumeFakeTx();
    tx2.resolutionRecord.update.mockRejectedValue(new Error("kaboom"));
    const onC2 = vi.fn();
    await expect(applyWritePort(tx2 as unknown as Prisma.TransactionClient, onC2).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("kaboom");
    expect(onC2).not.toHaveBeenCalled();
  });

  it("replay: retorna ANTES de leer parent/claims, dedup, create y update", async () => {
    const tx = volumeFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "corr-old", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 555 } });
    const out = await runApplyVolume(tx);
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 555, mutationCorrelationId: "corr-old", recovered: true });
    expect(tx.proposalClaim.findMany).not.toHaveBeenCalled();
    expect(tx.publisherEdition.findUnique).not.toHaveBeenCalled();
    expect(tx.volume.findUnique).not.toHaveBeenCalled();
    expect(tx.volume.create).not.toHaveBeenCalled();
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("gate inconsistente para volumen (appliedEditionId inesperado) → InconsistentApplyStateError", async () => {
    const tx = volumeFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "c", appliedWorkId: null, appliedEditionId: 9, appliedVolumeId: null } });
    await expect(runApplyVolume(tx)).rejects.toThrow(InconsistentApplyStateError);
  });
});

// ---------------------------------------------------------------------------
// Infra write-port — VOLUME (corrección; familia Mutation, ADR-007)
// ---------------------------------------------------------------------------
type VolCorrFakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  resolutionRecord: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  proposalClaim: { findMany: ReturnType<typeof vi.fn> };
  volume: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};
function volCorrFakeTx(over: Partial<{
  locked: unknown[]; resolution: unknown; claims: unknown[]; target: unknown; update: ReturnType<typeof vi.fn>;
}> = {}): VolCorrFakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "ACEPTADA", targetKind: "VOLUME", contentClass: "MANGA", version: 2, refWorkId: null, refEditionId: null, refVolumeId: 88 }]),
    resolutionRecord: {
      findUnique: vi.fn().mockResolvedValue(over.resolution === undefined
        ? { id: 42, outcome: "ACEPTADA", mutationCorrelationId: null, appliedWorkId: null, appliedEditionId: null, appliedVolumeId: null }
        : over.resolution),
      update: vi.fn().mockResolvedValue({}),
    },
    // corrección por defecto: fija el ISBN del volumen 88
    proposalClaim: { findMany: vi.fn().mockResolvedValue(over.claims ?? [
      { id: 31, attributeKind: "VOLUME_ISBN", value: "978-1", claimOperation: "SET", result: "ACEPTADA" },
    ]) },
    volume: {
      findUnique: vi.fn().mockResolvedValue(over.target === undefined ? { id: 88 } : over.target),
      update: over.update ?? vi.fn().mockResolvedValue({ id: 88 }),
    },
  };
}
const runApplyVolCorr = (tx: VolCorrFakeTx, onCommitted = vi.fn(), corr = "corr-c") =>
  applyWritePort(tx as unknown as Prisma.TransactionClient, onCommitted).apply({ proposalId: 5, idempotencyKey: "k1" }, corr);

describe("infra write-port — VOLUME (corrección)", () => {
  it("happy: lock → carga target (solo id) → UPDATE parcial → update único del RR (appliedVolumeId=refVolumeId)", async () => {
    const tx = volCorrFakeTx();
    const onCommitted = vi.fn();
    const out = await runApplyVolCorr(tx, onCommitted, "corr-c1");
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.volume.findUnique.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.volume.update.mock.invocationCallOrder[0]);
    // target: lookup exacto por id (NO por editionId_number: Mutation no re-parenta ni deduplica)
    expect(tx.volume.findUnique).toHaveBeenCalledWith({ where: { id: 88 }, select: { id: true } });
    // UPDATE parcial: solo la columna tocada (isbn); NO crea, NO toca editionId
    expect(tx.volume.update).toHaveBeenCalledTimes(1);
    expect(tx.volume.update).toHaveBeenCalledWith({ where: { id: 88 }, data: { isbn: "978-1" }, select: { id: true } });
    // RR: appliedVolumeId = refVolumeId (el volumen preexistente afectado) + correlation
    expect(tx.resolutionRecord.update).toHaveBeenCalledTimes(1);
    expect(tx.resolutionRecord.update).toHaveBeenCalledWith({ where: { proposalId: 5 }, data: { appliedVolumeId: 88, mutationCorrelationId: "corr-c1" } });
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 88, mutationCorrelationId: "corr-c1", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
    expect(Object.keys(tx)).not.toContain("publisherEdition");
  });

  it("UPDATE exacto = solo columnas tocadas (número SET + isbn REMOVE ⇒ {number, isbn:null})", async () => {
    const tx = volCorrFakeTx({ claims: [
      { id: 31, attributeKind: "VOLUME_NUMBER", value: 7, claimOperation: "SET", result: "ACEPTADA" },
      { id: 32, attributeKind: "VOLUME_ISBN", value: null, claimOperation: "REMOVE", result: "ACEPTADA" },
    ] });
    await runApplyVolCorr(tx);
    expect(tx.volume.update).toHaveBeenCalledWith({ where: { id: 88 }, data: { number: 7, isbn: null }, select: { id: true } });
  });

  it("EXTERNAL_VOLUME_ID (Whakoom, SET): el slot externo llega intacto (trimmed) al UPDATE, sin editionId", async () => {
    const tx = volCorrFakeTx({ claims: [
      { id: 31, attributeKind: "EXTERNAL_VOLUME_ID", value: { provider: "Whakoom", externalId: "  wc-42  " }, claimOperation: "SET", result: "ACEPTADA" },
    ] });
    const out = await runApplyVolCorr(tx, vi.fn(), "corr-ext");
    // el patch materializa whakoomComicId (trimmed); NO toca editionId; NO crea
    expect(tx.volume.update).toHaveBeenCalledTimes(1);
    expect(tx.volume.update).toHaveBeenCalledWith({ where: { id: 88 }, data: { whakoomComicId: "wc-42" }, select: { id: true } });
    expect(tx.resolutionRecord.update).toHaveBeenCalledTimes(1);
    expect(out.recovered).toBe(false);
  });

  it("patch vacío (solo claim no materializada) = no-op exitoso: NO hace UPDATE, sí marca el RR", async () => {
    const tx = volCorrFakeTx({ claims: [
      { id: 31, attributeKind: "VOLUME_TITLE", value: { text: "Tomo 1" }, claimOperation: "SET", result: "ACEPTADA" },
    ] });
    const out = await runApplyVolCorr(tx, vi.fn(), "corr-noop");
    expect(tx.volume.findUnique).toHaveBeenCalledTimes(1); // el target igual se valida
    expect(tx.volume.update).not.toHaveBeenCalled();
    expect(tx.resolutionRecord.update).toHaveBeenCalledWith({ where: { proposalId: 5 }, data: { appliedVolumeId: 88, mutationCorrelationId: "corr-noop" } });
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 88, mutationCorrelationId: "corr-noop", recovered: false });
  });

  it("target inexistente (refVolumeId null o fila ausente) → TargetVolumeNotFoundError, sin UPDATE ni RR", async () => {
    const tx1 = volCorrFakeTx({ locked: [{ id: 5, status: "ACEPTADA", targetKind: "VOLUME", contentClass: "MANGA", version: 2, refWorkId: null, refEditionId: null, refVolumeId: null }] });
    await expect(runApplyVolCorr(tx1)).rejects.toThrow(TargetVolumeNotFoundError);
    expect(tx1.volume.update).not.toHaveBeenCalled();
    expect(tx1.resolutionRecord.update).not.toHaveBeenCalled();
    const tx2 = volCorrFakeTx({ target: null });
    await expect(runApplyVolCorr(tx2)).rejects.toThrow(TargetVolumeNotFoundError);
    expect(tx2.volume.update).not.toHaveBeenCalled();
    expect(tx2.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("ADD sobre escalar (VOLUME_NUMBER) → ClaimSetInvalidError, sin UPDATE", async () => {
    const tx = volCorrFakeTx({ claims: [
      { id: 31, attributeKind: "VOLUME_NUMBER", value: 3, claimOperation: "ADD", result: "ACEPTADA" },
    ] });
    await expect(runApplyVolCorr(tx)).rejects.toThrow(ClaimSetInvalidError);
    expect(tx.volume.update).not.toHaveBeenCalled();
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("P2002 al actualizar el Volume (colisión de número) → CatalogConflictError, sin marcar Apply", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["Volume_editionId_number_key"] } });
    const tx = volCorrFakeTx({
      claims: [{ id: 31, attributeKind: "VOLUME_NUMBER", value: 9, claimOperation: "SET", result: "ACEPTADA" }],
      update: vi.fn().mockRejectedValue(p2002),
    });
    await expect(runApplyVolCorr(tx)).rejects.toThrow(CatalogConflictError);
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("error ≠ P2002 (FK/P2003) se propaga sin convertir; rollback (onCommitted no llamado)", async () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "6.19.3", meta: { field_name: "id" } });
    const tx = volCorrFakeTx({ update: vi.fn().mockRejectedValue(p2003) });
    const onC = vi.fn();
    await expect(applyWritePort(tx as unknown as Prisma.TransactionClient, onC).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    expect(onC).not.toHaveBeenCalled();
  });

  it("rollback: fallo en UPDATE del Volume o en update del RR propaga y NO captura", async () => {
    const tx1 = volCorrFakeTx({ update: vi.fn().mockRejectedValue(new Error("boom")) });
    const onC1 = vi.fn();
    await expect(applyWritePort(tx1 as unknown as Prisma.TransactionClient, onC1).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("boom");
    expect(onC1).not.toHaveBeenCalled();

    const tx2 = volCorrFakeTx();
    tx2.resolutionRecord.update.mockRejectedValue(new Error("kaboom"));
    const onC2 = vi.fn();
    await expect(applyWritePort(tx2 as unknown as Prisma.TransactionClient, onC2).apply({ proposalId: 5, idempotencyKey: "k" }, "c")).rejects.toThrow("kaboom");
    expect(onC2).not.toHaveBeenCalled();
  });

  it("replay consistente: retorna ANTES de leer claims/target y sin UPDATE ni update del RR", async () => {
    const tx = volCorrFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "corr-old", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 555 } });
    const out = await runApplyVolCorr(tx);
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, targetKind: "VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 555, mutationCorrelationId: "corr-old", recovered: true });
    expect(tx.proposalClaim.findMany).not.toHaveBeenCalled();
    expect(tx.volume.findUnique).not.toHaveBeenCalled();
    expect(tx.volume.update).not.toHaveBeenCalled();
    expect(tx.resolutionRecord.update).not.toHaveBeenCalled();
  });

  it("gate inconsistente (appliedWorkId inesperado para VOLUME) → InconsistentApplyStateError", async () => {
    const tx = volCorrFakeTx({ resolution: { id: 42, outcome: "ACEPTADA", mutationCorrelationId: "c", appliedWorkId: 9, appliedEditionId: null, appliedVolumeId: null } });
    await expect(runApplyVolCorr(tx)).rejects.toThrow(InconsistentApplyStateError);
  });
});

// ---------------------------------------------------------------------------
// Mutation Framework — audit
// ---------------------------------------------------------------------------
describe("mutación applyCatalogProposal — audit", () => {
  function spySink() {
    const entries: AuditEntry[] = [];
    const sink: AuditSink = { record: async (e) => void entries.push(e) };
    return { entries, sink };
  }
  const actor: Actor = { type: "admin", id: ADMIN };
  const read: ApplyReadPort = {};

  it("kind CONTRIB_APPLY_PROPOSAL, correlationId propagado al write-port, affected creation, sin contenido", async () => {
    const apply = vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_WORK", appliedWorkId: 777, appliedEditionId: null, appliedVolumeId: null, mutationCorrelationId: "corr-XYZ", recovered: false });
    const write: ApplyWritePort = { apply };
    const tx: TransactionRunner<ApplyReadPort, ApplyWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(applyCatalogProposal, { proposalId: 5, idempotencyKey: "k1" }, { read, transaction: tx, actor, dryRun: false, correlationId: "corr-XYZ", audit: spy.sink });
    expect(apply).toHaveBeenCalledWith({ proposalId: 5, idempotencyKey: "k1" }, "corr-XYZ");
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.kind).toBe("CONTRIB_APPLY_PROPOSAL");
    expect(success.affected).toEqual({ creates: 1, updates: 1, deletes: 0, entities: ["Work", "ResolutionRecord"] });
    expect(JSON.stringify(spy.entries)).not.toContain("Naruto");
  });

  it("recovered → affected en cero", async () => {
    const write: ApplyWritePort = { apply: vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_WORK", appliedWorkId: 555, appliedEditionId: null, appliedVolumeId: null, mutationCorrelationId: "c", recovered: true }) };
    const tx: TransactionRunner<ApplyReadPort, ApplyWritePort> = { run: (fn) => fn({ read, write }) };
    const r = await runMutation(applyCatalogProposal, { proposalId: 5, idempotencyKey: "k1" }, { read, transaction: tx, actor, dryRun: false });
    expect(r.affected).toEqual({ creates: 0, updates: 0, deletes: 0 });
  });

  it("NEW_EDITION → entities ['PublisherEdition','ResolutionRecord'] en la auditoría", async () => {
    const write: ApplyWritePort = { apply: vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_EDITION", appliedWorkId: null, appliedEditionId: 888, appliedVolumeId: null, mutationCorrelationId: "c", recovered: false }) };
    const tx: TransactionRunner<ApplyReadPort, ApplyWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(applyCatalogProposal, { proposalId: 5, idempotencyKey: "k1" }, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.affected).toEqual({ creates: 1, updates: 1, deletes: 0, entities: ["PublisherEdition", "ResolutionRecord"] });
  });

  it("NEW_VOLUME → entities ['Volume','ResolutionRecord'], sin número/isbn/external en auditoría", async () => {
    const write: ApplyWritePort = { apply: vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, targetKind: "NEW_VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 999, mutationCorrelationId: "c", recovered: false }) };
    const tx: TransactionRunner<ApplyReadPort, ApplyWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(applyCatalogProposal, { proposalId: 5, idempotencyKey: "k1" }, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.affected).toEqual({ creates: 1, updates: 1, deletes: 0, entities: ["Volume", "ResolutionRecord"] });
    // sin número/isbn/external en el audit (el summary es genérico por proposalId)
    const dump = JSON.stringify(spy.entries);
    expect(dump).not.toContain("978");
    expect(dump).not.toContain("wc-");
  });

  it("VOLUME (corrección) → entities ['Volume','ResolutionRecord'], affected mutación (creates:0, updates:2)", async () => {
    const write: ApplyWritePort = { apply: vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, targetKind: "VOLUME", appliedWorkId: null, appliedEditionId: null, appliedVolumeId: 88, mutationCorrelationId: "c", recovered: false }) };
    const tx: TransactionRunner<ApplyReadPort, ApplyWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(applyCatalogProposal, { proposalId: 5, idempotencyKey: "k1" }, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });
    const success = spy.entries.find((e) => e.phase === "success")!;
    // Mutation actualiza (no crea): creates 0. entities = Volume + ResolutionRecord.
    expect(success.affected).toEqual({ creates: 0, updates: 2, deletes: 0, entities: ["Volume", "ResolutionRecord"] });
  });

  // Decisión pineada: `affected` es una estimación conservadora para policy/auditoría; el
  // over-count en patch vacío es intencional. No refleja el nº exacto de sentencias SQL
  // (acá solo corre el UPDATE del ResolutionRecord). Se evita contaminar ApplyOutcome con
  // detalle operacional. Ver análisis best-effort vs exactitud.
  it("VOLUME (corrección) patch vacío: over-count deliberado (updates:2) aunque solo corra el update del RR", async () => {
    // write-port REAL sobre una corrección cuyas claims aceptadas no materializan nada → patch {}
    const fake = volCorrFakeTx({ claims: [
      { id: 31, attributeKind: "VOLUME_TITLE", value: { text: "Tomo 1" }, claimOperation: "SET", result: "ACEPTADA" },
    ] });
    const committed = vi.fn();
    const write = applyWritePort(fake as unknown as Prisma.TransactionClient, committed);
    const tx: TransactionRunner<ApplyReadPort, ApplyWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    const r = await runMutation(applyCatalogProposal, { proposalId: 5, idempotencyKey: "k1" }, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });
    // aplicación exitosa y NO replay
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ targetKind: "VOLUME", appliedVolumeId: 88, recovered: false }));
    // físicamente: patch vacío ⇒ NO se toca el Volume; SÍ se marca el ResolutionRecord
    expect(fake.volume.update).not.toHaveBeenCalled();
    expect(fake.resolutionRecord.update).toHaveBeenCalledTimes(1);
    // `affected` deliberadamente sobre-estimado; entidades correctas y sin afirmar creación (creates:0)
    expect(r.affected).toEqual({ creates: 0, updates: 2, deletes: 0, entities: ["Volume", "ResolutionRecord"] });
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.affected).toEqual({ creates: 0, updates: 2, deletes: 0, entities: ["Volume", "ResolutionRecord"] });
  });
});

// ---------------------------------------------------------------------------
// Action wrapper
// ---------------------------------------------------------------------------
describe("applyCatalogProposalAction", () => {
  const GENERIC = "No se pudo aplicar la propuesta.";
  const cmd = { proposalId: "5", idempotencyKey: "k1" };
  const okResult = { proposalId: "5", resolutionRecordId: "42", targetKind: "NEW_WORK" as const, appliedWorkId: "777", appliedEditionId: null, appliedVolumeId: null, mutationCorrelationId: "corr-1", recovered: false };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(auth).mockResolvedValue({ user: { id: ADMIN, email: "a@b.com" } } as never);
    vi.mocked(isAdmin).mockReturnValue(true);
    vi.mocked(applyCatalogProposalUseCase).mockResolvedValue(okResult);
  });

  it("flag off / anónimo / no-admin → genérico, sin use-case (anti-enumeración)", async () => {
    vi.mocked(isEnabled).mockResolvedValueOnce(false);
    expect(await applyCatalogProposalAction(cmd)).toEqual({ ok: false, error: GENERIC });
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect(await applyCatalogProposalAction(cmd)).toEqual({ ok: false, error: GENERIC });
    vi.mocked(isAdmin).mockReturnValueOnce(false);
    expect(await applyCatalogProposalAction(cmd)).toEqual({ ok: false, error: GENERIC });
    expect(applyCatalogProposalUseCase).not.toHaveBeenCalled();
  });

  it("propuesta inexistente → genérico (anti-enumeración)", async () => {
    vi.mocked(applyCatalogProposalUseCase).mockRejectedValueOnce(new ProposalNotFoundError());
    expect(await applyCatalogProposalAction(cmd)).toEqual({ ok: false, error: GENERIC });
  });

  it("admin válido → ok con appliedEditionId/appliedVolumeId null y targetKind NEW_WORK", async () => {
    expect(await applyCatalogProposalAction(cmd)).toEqual({ ok: true, ...okResult });
  });

  it("errores operativos → mensaje específico", async () => {
    vi.mocked(applyCatalogProposalUseCase).mockRejectedValueOnce(new TargetKindNotSupportedError("NEW_EDITION"));
    expect((await applyCatalogProposalAction(cmd) as { ok: false; error: string }).error).toContain("NEW_WORK");
    vi.mocked(applyCatalogProposalUseCase).mockRejectedValueOnce(new CatalogConflictError());
    expect((await applyCatalogProposalAction(cmd) as { ok: false; error: string }).error).toContain("catálogo");
    vi.mocked(applyCatalogProposalUseCase).mockRejectedValueOnce(new ParentWorkNotFoundError());
    expect((await applyCatalogProposalAction(cmd) as { ok: false; error: string }).error).toContain("obra padre");
    vi.mocked(applyCatalogProposalUseCase).mockRejectedValueOnce(new ParentEditionNotFoundError());
    expect((await applyCatalogProposalAction(cmd) as { ok: false; error: string }).error).toContain("edición padre");
  });

  it("NEW_VOLUME → ok con appliedVolumeId string y appliedWorkId/appliedEditionId null", async () => {
    vi.mocked(applyCatalogProposalUseCase).mockResolvedValueOnce({
      proposalId: "5", resolutionRecordId: "42", targetKind: "NEW_VOLUME",
      appliedWorkId: null, appliedEditionId: null, appliedVolumeId: "999",
      mutationCorrelationId: "corr-1", recovered: false,
    });
    expect(await applyCatalogProposalAction(cmd)).toEqual({
      ok: true, proposalId: "5", resolutionRecordId: "42", targetKind: "NEW_VOLUME",
      appliedWorkId: null, appliedEditionId: null, appliedVolumeId: "999",
      mutationCorrelationId: "corr-1", recovered: false,
    });
  });

  it("VOLUME (corrección) → ok con targetKind VOLUME y appliedVolumeId string", async () => {
    vi.mocked(applyCatalogProposalUseCase).mockResolvedValueOnce({
      proposalId: "5", resolutionRecordId: "42", targetKind: "VOLUME",
      appliedWorkId: null, appliedEditionId: null, appliedVolumeId: "88",
      mutationCorrelationId: "corr-1", recovered: false,
    });
    expect(await applyCatalogProposalAction(cmd)).toEqual({
      ok: true, proposalId: "5", resolutionRecordId: "42", targetKind: "VOLUME",
      appliedWorkId: null, appliedEditionId: null, appliedVolumeId: "88",
      mutationCorrelationId: "corr-1", recovered: false,
    });
  });

  it("target inexistente → mensaje específico (volumen a corregir)", async () => {
    vi.mocked(applyCatalogProposalUseCase).mockRejectedValueOnce(new TargetVolumeNotFoundError());
    expect((await applyCatalogProposalAction(cmd) as { ok: false; error: string }).error).toContain("volumen a corregir");
  });
});
