import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestProposalInfoUseCase } from "@/lib/contributions/requestProposalInfo";
import { prismaRequestInfoIO } from "@/lib/infra/proposal/requestInfo";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { IdempotencyConflictError } from "@/lib/domain/proposal/requestInfo";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import type { ExistingInfoRequest, RequestInfoOutcome } from "@/lib/domain/proposal/requestInfo";
import type { RequestInfoIO } from "@/lib/infra/proposal/requestInfo";

vi.mock("@/lib/infra/proposal/requestInfo", async (orig) => {
  const actual = await orig<typeof import("@/lib/infra/proposal/requestInfo")>();
  return { ...actual, prismaRequestInfoIO: vi.fn() };
});
vi.mock("@/lib/infra/mutations", () => ({
  PrismaAuditSink: class { async record() {} },
  PrismaIdempotencyStore: class {},
}));

const MOD = "mod-1";
const command = { proposalId: "5", publicMessage: "hola", privateNote: null as string | null, idempotencyKey: "k1" };

function harness(opts: { write: "created" | "recovered" | "p2002" | "boom"; recovery?: ExistingInfoRequest | null }) {
  const findByKey = vi.fn().mockResolvedValue(opts.recovery ?? null);
  let committed: RequestInfoOutcome | null = null;
  const requestInfo = vi.fn(async (seed: { proposalId: number; idempotencyKey: string }) => {
    if (opts.write === "p2002") throw new ProposalAlreadyExistsError(seed.idempotencyKey);
    if (opts.write === "boom") throw new Error("boom");
    committed = opts.write === "created"
      ? { proposalId: seed.proposalId, infoRequestId: 99, proposalStatus: "NEEDS_INFO", recovered: false }
      : { proposalId: seed.proposalId, infoRequestId: 77, proposalStatus: "NEEDS_INFO", recovered: true };
    return committed;
  });
  const read = { findByIdempotencyKey: findByKey };
  const write = { requestInfo };
  const io = { read, transaction: { run: (fn: (x: { read: unknown; write: unknown }) => Promise<unknown>) => fn({ read, write }) } };
  const getCommittedResult = vi.fn((): RequestInfoOutcome => {
    if (!committed) throw new CommittedResultUnavailableError();
    return { ...committed };
  });
  return { ioHandle: { io, getCommittedResult } as unknown as RequestInfoIO, requestInfo, findByKey, getCommittedResult };
}

const existing = (o: Partial<ExistingInfoRequest> = {}): ExistingInfoRequest => ({
  infoRequestId: 77, proposalId: 5, scope: "PROPOSAL", targetUserId: null,
  targetContributionId: null, prompt: "hola", privateNote: null, ...o,
});

describe("requestProposalInfoUseCase — idempotencia (orquestación)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creación nueva → recovered:false, ids stringificados, usa getCommittedResult", async () => {
    const h = harness({ write: "created" });
    vi.mocked(prismaRequestInfoIO).mockReturnValue(h.ioHandle);
    const r = await requestProposalInfoUseCase(command, MOD);
    expect(r).toEqual({ proposalId: "5", infoRequestId: "99", proposalStatus: "NEEDS_INFO", recovered: false });
    expect(h.requestInfo).toHaveBeenCalledTimes(1);
    expect(h.getCommittedResult).toHaveBeenCalledTimes(1);
  });

  it("replay bajo lock (write recovered) → recovered:true, mismo infoRequestId", async () => {
    const h = harness({ write: "recovered" });
    vi.mocked(prismaRequestInfoIO).mockReturnValue(h.ioHandle);
    const r = await requestProposalInfoUseCase(command, MOD);
    expect(r).toEqual({ proposalId: "5", infoRequestId: "77", proposalStatus: "NEEDS_INFO", recovered: true });
  });

  it("carrera P2002 cross-proposal (misma key, otra propuesta) → IdempotencyConflictError", async () => {
    const h = harness({ write: "p2002", recovery: existing({ proposalId: 6 }) });
    vi.mocked(prismaRequestInfoIO).mockReturnValue(h.ioHandle);
    await expect(requestProposalInfoUseCase(command, MOD)).rejects.toThrow(IdempotencyConflictError);
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("carrera P2002 con payload compatible (misma propuesta) → recovered:true", async () => {
    const h = harness({ write: "p2002", recovery: existing({ proposalId: 5, prompt: "hola", privateNote: null }) });
    vi.mocked(prismaRequestInfoIO).mockReturnValue(h.ioHandle);
    const r = await requestProposalInfoUseCase(command, MOD);
    expect(r).toEqual({ proposalId: "5", infoRequestId: "77", proposalStatus: "NEEDS_INFO", recovered: true });
  });

  it("error no relacionado se propaga (no se interpreta como replay)", async () => {
    const h = harness({ write: "boom" });
    vi.mocked(prismaRequestInfoIO).mockReturnValue(h.ioHandle);
    let caught: unknown;
    try { await requestProposalInfoUseCase(command, MOD); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(IdempotencyConflictError);
    expect((caught as Error).message).toBe("boom");
    expect(h.findByKey).not.toHaveBeenCalled();
  });
});
