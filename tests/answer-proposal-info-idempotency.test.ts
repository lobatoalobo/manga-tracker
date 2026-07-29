import { describe, it, expect, vi, beforeEach } from "vitest";
import { answerProposalInfoRequestUseCase } from "@/lib/contributions/answerProposalInfoRequest";
import { prismaAnswerInfoIO } from "@/lib/infra/proposal/answerInfo";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { IdempotencyConflictError } from "@/lib/domain/proposal/answerInfo";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import type { AnswerOutcome, ExistingAnswerContribution } from "@/lib/domain/proposal/answerInfo";
import type { AnswerInfoIO } from "@/lib/infra/proposal/answerInfo";

vi.mock("@/lib/infra/proposal/answerInfo", async (orig) => {
  const actual = await orig<typeof import("@/lib/infra/proposal/answerInfo")>();
  return { ...actual, prismaAnswerInfoIO: vi.fn() };
});
vi.mock("@/lib/infra/mutations", () => ({
  PrismaAuditSink: class { async record() {} },
  PrismaIdempotencyStore: class {},
}));

const ORIG = "orig-1";
const workClaim = { attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET" as const, value: { language: "es", text: "x" } };
const command = { proposalId: "5", infoRequestId: "7", claims: [workClaim], idempotencyKey: "k1" };

function harness(opts: { write: "created" | "recovered" | "p2002" | "boom"; recovery?: ExistingAnswerContribution | null }) {
  const findByKey = vi.fn().mockResolvedValue(opts.recovery ?? null);
  let committed: AnswerOutcome | null = null;
  const answer = vi.fn(async (seed: { proposalId: number; infoRequestId: number }) => {
    if (opts.write === "p2002") throw new ProposalAlreadyExistsError("k1");
    if (opts.write === "boom") throw new Error("boom");
    committed = opts.write === "created"
      ? { proposalId: seed.proposalId, contributionId: 99, infoRequestId: seed.infoRequestId, proposalStatus: "SUBMITTED", recovered: false }
      : { proposalId: seed.proposalId, contributionId: 88, infoRequestId: seed.infoRequestId, proposalStatus: "SUBMITTED", recovered: true };
    return committed;
  });
  const read = { findContributionByIdempotencyKey: findByKey };
  const write = { answer };
  const io = { read, transaction: { run: (fn: (x: { read: unknown; write: unknown }) => Promise<unknown>) => fn({ read, write }) } };
  const getCommittedResult = vi.fn((): AnswerOutcome => {
    if (!committed) throw new CommittedResultUnavailableError();
    return { ...committed };
  });
  return { ioHandle: { io, getCommittedResult } as unknown as AnswerInfoIO, answer, findByKey, getCommittedResult };
}

const existing = (o: Partial<ExistingAnswerContribution> = {}): ExistingAnswerContribution => ({
  id: 88, proposalId: 5, authorId: ORIG, answersInfoRequestId: 7,
  claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "x" } }], ...o,
});

describe("answerProposalInfoRequestUseCase — idempotencia (orquestación)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creación nueva → recovered:false, ids stringificados", async () => {
    const h = harness({ write: "created" });
    vi.mocked(prismaAnswerInfoIO).mockReturnValue(h.ioHandle);
    const r = await answerProposalInfoRequestUseCase(command, ORIG);
    expect(r).toEqual({ proposalId: "5", infoRequestId: "7", contributionId: "99", proposalStatus: "SUBMITTED", recovered: false });
    expect(h.answer).toHaveBeenCalledTimes(1);
    expect(h.getCommittedResult).toHaveBeenCalledTimes(1);
  });

  it("replay bajo lock → recovered:true, misma contribución", async () => {
    const h = harness({ write: "recovered" });
    vi.mocked(prismaAnswerInfoIO).mockReturnValue(h.ioHandle);
    const r = await answerProposalInfoRequestUseCase(command, ORIG);
    expect(r).toEqual({ proposalId: "5", infoRequestId: "7", contributionId: "88", proposalStatus: "SUBMITTED", recovered: true });
  });

  it("carrera P2002 cross-proposal → IdempotencyConflictError", async () => {
    const h = harness({ write: "p2002", recovery: existing({ proposalId: 6 }) });
    vi.mocked(prismaAnswerInfoIO).mockReturnValue(h.ioHandle);
    await expect(answerProposalInfoRequestUseCase(command, ORIG)).rejects.toThrow(IdempotencyConflictError);
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("carrera P2002 compatible → recovered:true", async () => {
    const h = harness({ write: "p2002", recovery: existing() });
    vi.mocked(prismaAnswerInfoIO).mockReturnValue(h.ioHandle);
    const r = await answerProposalInfoRequestUseCase(command, ORIG);
    expect(r).toEqual({ proposalId: "5", infoRequestId: "7", contributionId: "88", proposalStatus: "SUBMITTED", recovered: true });
  });

  it("error no relacionado se propaga", async () => {
    const h = harness({ write: "boom" });
    vi.mocked(prismaAnswerInfoIO).mockReturnValue(h.ioHandle);
    let caught: unknown;
    try { await answerProposalInfoRequestUseCase(command, ORIG); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(IdempotencyConflictError);
    expect((caught as Error).message).toBe("boom");
    expect(h.findByKey).not.toHaveBeenCalled();
  });
});
