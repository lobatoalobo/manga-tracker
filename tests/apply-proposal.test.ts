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
  communityEditionSlug,
  classifyApplyState,
  WORK_MATERIALIZED_KINDS,
  WORK_ACCEPTED_NOT_MATERIALIZED_KINDS,
  EDITION_MATERIALIZED_KINDS,
  EDITION_ACCEPTED_NOT_MATERIALIZED_KINDS,
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
  type AppliedRef,
  type ApplyClaimRow,
  type ApplyReadPort,
  type ApplyWritePort,
  type ExistingResolutionForApply,
} from "@/lib/domain/proposal/apply";
import { ATTRIBUTE_KIND_LEVEL } from "@/lib/domain/proposal/addContribution";

/** Refs esperadas del vertical NEW_WORK (equivalencia del gate previo). */
const WORK_REFS: ReadonlySet<AppliedRef> = new Set<AppliedRef>(["work"]);
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
const claim = (attributeKind: string, value: unknown, id = 1, result = "ACEPTADA"): ApplyClaimRow =>
  ({ id, attributeKind, value, result });
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
    await expect(runApply(fakeTx({ locked: [{ id: 5, status: "ACEPTADA", targetKind: "NEW_VOLUME", contentClass: "MANGA", version: 2 }] }))).rejects.toThrow(TargetKindNotSupportedError);
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
  });
});
