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
  buildAnswerSeed,
  fingerprintOfSeed,
  sameAnswerFingerprint,
  assertCompatibleAnswerReplay,
  assertRequestAnswerable,
  InfoRequestNotAnswerableError,
  NotProposalOriginatorError,
  IdempotencyConflictError,
  type AnswerReadPort,
  type AnswerSeed,
  type AnswerWritePort,
  type ExistingAnswerContribution,
  type InfoRequestForAnswer,
} from "@/lib/domain/proposal/answerInfo";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { ProposalNotFoundError } from "@/lib/domain/proposal/requestInfo";
import { answerWritePort } from "@/lib/infra/proposal/answerInfo";
import { answerProposalInfoRequest } from "@/lib/contributions/mutations/answerProposalInfoRequest";
import { answerProposalInfoRequestAction } from "@/app/contribuciones/actions";
import { isEnabled } from "@/lib/featureFlags";
import { requireUserId } from "@/auth";
import { answerProposalInfoRequestUseCase } from "@/lib/contributions/answerProposalInfoRequest";

vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), requireUserId: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: vi.fn(), RL: {} }));
vi.mock("@/lib/contributions/answerProposalInfoRequest", async (orig) => {
  const actual = await orig<typeof import("@/lib/contributions/answerProposalInfoRequest")>();
  return { ...actual, answerProposalInfoRequestUseCase: vi.fn() };
});

const ORIG = "orig-1";
const workClaim = { attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET" as const, value: { language: "es", text: "x" } };
const cmd = (o: Partial<{ proposalId: string; infoRequestId: string; claims: unknown[]; idempotencyKey: string }> = {}) =>
  ({ proposalId: "5", infoRequestId: "7", claims: [workClaim], idempotencyKey: "k1", ...o }) as never;
const seedOf = (o = {}) => buildAnswerSeed(cmd(o), ORIG);

describe("dominio — reuso de validación de claims + huella", () => {
  it("reutiliza la validación de claims (vacío / SET sin value / kind desconocido)", () => {
    expect(() => buildAnswerSeed(cmd({ claims: [] }), ORIG)).toThrow(ValidationError);
    expect(() => buildAnswerSeed(cmd({ claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: null }] }), ORIG)).toThrow(ValidationError);
    expect(() => buildAnswerSeed(cmd({ claims: [{ attributeKind: "FOO", contractVersion: 1, claimOperation: "SET", value: 1 }] }), ORIG)).toThrow(ValidationError);
  });
  it("la huella incorpora answersInfoRequestId", () => {
    const a = fingerprintOfSeed(seedOf({ infoRequestId: "7" }));
    const b = fingerprintOfSeed(seedOf({ infoRequestId: "8" }));
    expect(sameAnswerFingerprint(a, b)).toBe(false);
  });
  const existing = (o: Partial<ExistingAnswerContribution> = {}): ExistingAnswerContribution => ({
    id: 88, proposalId: 5, authorId: ORIG, answersInfoRequestId: 7,
    claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "x" } }], ...o,
  });
  it("misma huella → replay compatible; distinta → conflicto", () => {
    expect(() => assertCompatibleAnswerReplay(seedOf(), existing())).not.toThrow();
    expect(() => assertCompatibleAnswerReplay(seedOf(), existing({ claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "OTRO" } }] }))).toThrow(IdempotencyConflictError);
    expect(() => assertCompatibleAnswerReplay(seedOf(), existing({ answersInfoRequestId: 9 }))).toThrow(IdempotencyConflictError);
    expect(() => assertCompatibleAnswerReplay(seedOf(), existing({ authorId: "otro" }))).toThrow(IdempotencyConflictError);
  });
  it("assertRequestAnswerable: request inválido / scope / otra propuesta / cerrado", () => {
    const ok: InfoRequestForAnswer = { id: 7, proposalId: 5, scope: "PROPOSAL", targetUserId: null, targetContributionId: null, status: "ABIERTO" };
    expect(() => assertRequestAnswerable(ok, 5)).not.toThrow();
    expect(() => assertRequestAnswerable(null, 5)).toThrow(InfoRequestNotAnswerableError);
    expect(() => assertRequestAnswerable({ ...ok, scope: "CONTRIBUTION" }, 5)).toThrow(InfoRequestNotAnswerableError);
    expect(() => assertRequestAnswerable({ ...ok, proposalId: 6 }, 5)).toThrow(InfoRequestNotAnswerableError);
    expect(() => assertRequestAnswerable({ ...ok, status: "ANSWERED" }, 5)).toThrow(InfoRequestNotAnswerableError);
    expect(() => assertRequestAnswerable({ ...ok, targetUserId: "u9" }, 5)).toThrow(InfoRequestNotAnswerableError);
  });
});

// ---- write-port con tx falsa ----
type FakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  proposalContribution: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  proposalInfoRequest: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  catalogProposal: { update: ReturnType<typeof vi.fn> };
};
function fakeTx(over: Partial<{ locked: unknown[]; existing: unknown; request: unknown; create: ReturnType<typeof vi.fn>; remainingOpen: unknown }> = {}): FakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "NEEDS_INFO", originatorUserId: ORIG, targetKind: "WORK", version: 1 }]),
    proposalContribution: {
      findUnique: vi.fn().mockResolvedValue(over.existing ?? null),
      create: over.create ?? vi.fn().mockResolvedValue({ id: 99 }),
    },
    proposalInfoRequest: {
      findUnique: vi.fn().mockResolvedValue(over.request ?? { id: 7, proposalId: 5, scope: "PROPOSAL", targetUserId: null, targetContributionId: null, status: "ABIERTO" }),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(over.remainingOpen ?? null),
    },
    catalogProposal: { update: vi.fn().mockResolvedValue({}) },
  };
}
const runAnswer = (tx: FakeTx, onCommitted = vi.fn()) => answerWritePort(tx as unknown as Prisma.TransactionClient, onCommitted);

describe("infra write-port — persistencia, atomicidad, transición condicional", () => {
  it("crea contribución+claims (VISIBLE, answersInfoRequestId), cierra request, transiciona y bump version", async () => {
    const tx = fakeTx();
    const onCommitted = vi.fn();
    const out = await runAnswer(tx, onCommitted).answer(seedOf());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // lock
    expect(tx.proposalContribution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ proposalId: 5, authorId: ORIG, visibility: "VISIBLE", answersInfoRequestId: 7, idempotencyKey: "k1" }),
    }));
    expect(tx.proposalInfoRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 }, data: expect.objectContaining({ status: "ANSWERED" }),
    }));
    expect(tx.catalogProposal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 }, data: { status: "SUBMITTED", version: { increment: 1 } },
    }));
    expect(out).toEqual({ proposalId: 5, contributionId: 99, infoRequestId: 7, proposalStatus: "SUBMITTED", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
  });

  it("transición defensiva: si queda otro request ABIERTO, NO transiciona ni bump version", async () => {
    const tx = fakeTx({ remainingOpen: { id: 70 } });
    const out = await runAnswer(tx).answer(seedOf());
    expect(tx.catalogProposal.update).not.toHaveBeenCalled();
    expect(out.proposalStatus).toBe("NEEDS_INFO");
  });

  it("replay (misma huella): recupera, NO crea/cierra/transiciona/bump", async () => {
    const tx = fakeTx({ existing: { id: 88, proposalId: 5, authorId: ORIG, answersInfoRequestId: 7, claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "x" } }] } });
    const out = await runAnswer(tx).answer(seedOf());
    expect(tx.proposalContribution.create).not.toHaveBeenCalled();
    expect(tx.proposalInfoRequest.update).not.toHaveBeenCalled();
    expect(tx.catalogProposal.update).not.toHaveBeenCalled();
    expect(out).toEqual({ proposalId: 5, contributionId: 88, infoRequestId: 7, proposalStatus: "NEEDS_INFO", recovered: true });
  });

  it("replay incompatible → IdempotencyConflictError, sin escribir", async () => {
    const tx = fakeTx({ existing: { id: 88, proposalId: 5, authorId: ORIG, answersInfoRequestId: 7, claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "OTRO" } }] } });
    await expect(runAnswer(tx).answer(seedOf())).rejects.toThrow(IdempotencyConflictError);
    expect(tx.proposalContribution.create).not.toHaveBeenCalled();
  });

  it("actor no originador → NotProposalOriginatorError (antes de la idempotencia)", async () => {
    const tx = fakeTx({ locked: [{ id: 5, status: "NEEDS_INFO", originatorUserId: "otro", targetKind: "WORK", version: 1 }] });
    await expect(runAnswer(tx).answer(seedOf())).rejects.toThrow(NotProposalOriginatorError);
    expect(tx.proposalContribution.findUnique).not.toHaveBeenCalled(); // ni siquiera mira la key
  });

  it("propuesta inexistente (lock vacío) → ProposalNotFoundError", async () => {
    await expect(runAnswer(fakeTx({ locked: [] })).answer(seedOf())).rejects.toThrow(ProposalNotFoundError);
  });

  it("request cerrado / de otra propuesta → InfoRequestNotAnswerableError", async () => {
    await expect(runAnswer(fakeTx({ request: { id: 7, proposalId: 5, scope: "PROPOSAL", targetUserId: null, targetContributionId: null, status: "ANSWERED" } })).answer(seedOf())).rejects.toThrow(InfoRequestNotAnswerableError);
    await expect(runAnswer(fakeTx({ request: { id: 7, proposalId: 6, scope: "PROPOSAL", targetUserId: null, targetContributionId: null, status: "ABIERTO" } })).answer(seedOf())).rejects.toThrow(InfoRequestNotAnswerableError);
  });

  it("propuesta no NEEDS_INFO → InfoRequestNotAnswerableError", async () => {
    await expect(runAnswer(fakeTx({ locked: [{ id: 5, status: "SUBMITTED", originatorUserId: ORIG, targetKind: "WORK", version: 1 }] })).answer(seedOf())).rejects.toThrow(InfoRequestNotAnswerableError);
  });

  it("P2002 en create → ProposalAlreadyExistsError, sin cerrar el request", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["ProposalContribution_idempotencyKey_key"] } });
    const tx = fakeTx({ create: vi.fn().mockRejectedValue(p2002) });
    await expect(runAnswer(tx).answer(seedOf())).rejects.toThrow(ProposalAlreadyExistsError);
    expect(tx.proposalInfoRequest.update).not.toHaveBeenCalled();
  });

  it("error en la transición propaga y NO captura", async () => {
    const tx = fakeTx();
    tx.catalogProposal.update.mockRejectedValue(new Error("boom"));
    const onCommitted = vi.fn();
    await expect(runAnswer(tx, onCommitted).answer(seedOf())).rejects.toThrow("boom");
    expect(onCommitted).not.toHaveBeenCalled();
  });
});

// ---- contrato de mutación ----
describe("mutación answerProposalInfoRequest — audit", () => {
  function spySink() {
    const entries: AuditEntry[] = [];
    const sink: AuditSink = { record: async (e) => void entries.push(e) };
    return { entries, sink };
  }
  const actor: Actor = { type: "user", id: ORIG };
  it("audita success con kind CONTRIB_ANSWER_INFO y sin contenido de claims", async () => {
    const seed = buildAnswerSeed(cmd({ claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { text: "SENSITIVE_VALUE" } }] }), ORIG);
    const write: AnswerWritePort = { answer: vi.fn().mockResolvedValue({ proposalId: 5, contributionId: 99, infoRequestId: 7, proposalStatus: "SUBMITTED", recovered: false }) };
    const read: AnswerReadPort = { findContributionByIdempotencyKey: vi.fn() };
    const tx: TransactionRunner<AnswerReadPort, AnswerWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(answerProposalInfoRequest, seed, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.kind).toBe("CONTRIB_ANSWER_INFO");
    expect(success.affected).toEqual({ creates: 2, updates: 2, deletes: 0, entities: ["ProposalContribution", "ProposalClaim", "ProposalInfoRequest", "CatalogProposal"] });
    expect(JSON.stringify(spy.entries)).not.toContain("SENSITIVE_VALUE");
  });
  it("recovered → affected en cero", async () => {
    const write: AnswerWritePort = { answer: vi.fn().mockResolvedValue({ proposalId: 5, contributionId: 88, infoRequestId: 7, proposalStatus: "SUBMITTED", recovered: true }) };
    const read: AnswerReadPort = { findContributionByIdempotencyKey: vi.fn() };
    const tx: TransactionRunner<AnswerReadPort, AnswerWritePort> = { run: (fn) => fn({ read, write }) };
    const r = await runMutation(answerProposalInfoRequest, seedOf(), { read, transaction: tx, actor, dryRun: false });
    expect(r.affected).toEqual({ creates: 0, updates: 0, deletes: 0 });
  });
});

// ---- action ----
describe("answerProposalInfoRequestAction", () => {
  const GENERIC = "No se pudo procesar la respuesta.";
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(requireUserId).mockResolvedValue(ORIG);
    vi.mocked(answerProposalInfoRequestUseCase).mockResolvedValue({ proposalId: "5", infoRequestId: "7", contributionId: "99", proposalStatus: "SUBMITTED", recovered: false });
  });
  it("flag off → genérico, sin use-case", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    expect(await answerProposalInfoRequestAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(answerProposalInfoRequestUseCase).not.toHaveBeenCalled();
  });
  it("anónimo → genérico", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Error("No autenticado"));
    expect(await answerProposalInfoRequestAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(answerProposalInfoRequestUseCase).not.toHaveBeenCalled();
  });
  it("originador → ok", async () => {
    expect(await answerProposalInfoRequestAction(cmd())).toEqual({ ok: true, proposalId: "5", infoRequestId: "7", contributionId: "99", proposalStatus: "SUBMITTED", recovered: false });
  });
  it("no-originador / inexistente → genérico (anti-enumeración)", async () => {
    vi.mocked(answerProposalInfoRequestUseCase).mockRejectedValueOnce(new NotProposalOriginatorError());
    expect(await answerProposalInfoRequestAction(cmd())).toEqual({ ok: false, error: GENERIC });
    vi.mocked(answerProposalInfoRequestUseCase).mockRejectedValueOnce(new ProposalNotFoundError());
    expect(await answerProposalInfoRequestAction(cmd())).toEqual({ ok: false, error: GENERIC });
  });
  it("errores operativos → mensaje específico", async () => {
    vi.mocked(answerProposalInfoRequestUseCase).mockRejectedValueOnce(new InfoRequestNotAnswerableError());
    expect((await answerProposalInfoRequestAction(cmd()) as { ok: false; error: string }).error).toContain("abierta");
    vi.mocked(answerProposalInfoRequestUseCase).mockRejectedValueOnce(new IdempotencyConflictError("La clave de idempotencia ya se usó para otra respuesta distinta."));
    expect((await answerProposalInfoRequestAction(cmd()) as { ok: false; error: string }).error).toContain("idempotencia");
  });
});
