import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyCatalogProposalUseCase } from "@/lib/contributions/applyCatalogProposal";
import { prismaApplyIO } from "@/lib/infra/proposal/apply";
import { CatalogConflictError } from "@/lib/domain/proposal/apply";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import type { ApplyOutcome } from "@/lib/domain/proposal/apply";
import type { ApplyIO } from "@/lib/infra/proposal/apply";

vi.mock("@/lib/infra/proposal/apply", async (orig) => {
  const actual = await orig<typeof import("@/lib/infra/proposal/apply")>();
  return { ...actual, prismaApplyIO: vi.fn() };
});
vi.mock("@/lib/infra/mutations", () => ({
  PrismaAuditSink: class { async record() {} },
  PrismaIdempotencyStore: class {},
}));

const ADMIN = "admin-1";
const command = { proposalId: "5", idempotencyKey: "k1" };

function harness(opts: { write: "created" | "recovered" | "conflict" | "boom" }) {
  let committed: ApplyOutcome | null = null;
  const apply = vi.fn(async (seed: { proposalId: number }, correlationId: string) => {
    if (opts.write === "conflict") throw new CatalogConflictError();
    if (opts.write === "boom") throw new Error("boom");
    committed = {
      proposalId: seed.proposalId, resolutionRecordId: 42, appliedWorkId: 777,
      mutationCorrelationId: correlationId, recovered: opts.write === "recovered",
    };
    return committed;
  });
  const read = {};
  const write = { apply };
  const io = { read, transaction: { run: (fn: (x: { read: unknown; write: unknown }) => Promise<unknown>) => fn({ read, write }) } };
  const getCommittedResult = vi.fn((): ApplyOutcome => {
    if (!committed) throw new CommittedResultUnavailableError();
    return { ...committed };
  });
  return { ioHandle: { io, getCommittedResult } as unknown as ApplyIO, apply, getCommittedResult };
}

describe("applyCatalogProposalUseCase — idempotencia / orquestación", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aplicación nueva → recovered:false, NEW_WORK, edition/volume null, correlationId presente", async () => {
    const h = harness({ write: "created" });
    vi.mocked(prismaApplyIO).mockReturnValue(h.ioHandle);
    const r = await applyCatalogProposalUseCase(command, ADMIN);
    expect(r).toEqual({
      proposalId: "5", resolutionRecordId: "42", targetKind: "NEW_WORK",
      appliedWorkId: "777", appliedEditionId: null, appliedVolumeId: null,
      mutationCorrelationId: expect.any(String), recovered: false,
    });
    expect(r.mutationCorrelationId.length).toBeGreaterThan(0);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("replay bajo lock → recovered:true", async () => {
    const h = harness({ write: "recovered" });
    vi.mocked(prismaApplyIO).mockReturnValue(h.ioHandle);
    const r = await applyCatalogProposalUseCase(command, ADMIN);
    expect(r.recovered).toBe(true);
    expect(r.appliedWorkId).toBe("777");
  });

  it("conflicto de catálogo se propaga (sin recuperar)", async () => {
    const h = harness({ write: "conflict" });
    vi.mocked(prismaApplyIO).mockReturnValue(h.ioHandle);
    await expect(applyCatalogProposalUseCase(command, ADMIN)).rejects.toThrow(CatalogConflictError);
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("error no relacionado se propaga", async () => {
    const h = harness({ write: "boom" });
    vi.mocked(prismaApplyIO).mockReturnValue(h.ioHandle);
    await expect(applyCatalogProposalUseCase(command, ADMIN)).rejects.toThrow("boom");
  });

  it("concurrencia: primero aplica (create), segundo recupera (serializado por el lock)", async () => {
    const first = harness({ write: "created" });
    vi.mocked(prismaApplyIO).mockReturnValue(first.ioHandle);
    const r1 = await applyCatalogProposalUseCase(command, ADMIN);
    expect(r1.recovered).toBe(false);

    const second = harness({ write: "recovered" });
    vi.mocked(prismaApplyIO).mockReturnValue(second.ioHandle);
    const r2 = await applyCatalogProposalUseCase(command, ADMIN);
    expect(r2.recovered).toBe(true);
    expect(r2.appliedWorkId).toBe(r1.appliedWorkId);
  });
});
