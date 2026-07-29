import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCatalogProposalUseCase } from "@/lib/contributions/resolveCatalogProposal";
import { prismaResolveIO } from "@/lib/infra/proposal/resolve";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { IdempotencyConflictError } from "@/lib/domain/proposal/resolve";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import type { ResolveOutcome, ResolutionState } from "@/lib/domain/proposal/resolve";
import type { ResolveIO } from "@/lib/infra/proposal/resolve";

vi.mock("@/lib/infra/proposal/resolve", async (orig) => {
  const actual = await orig<typeof import("@/lib/infra/proposal/resolve")>();
  return { ...actual, prismaResolveIO: vi.fn() };
});
vi.mock("@/lib/infra/mutations", () => ({
  PrismaAuditSink: class { async record() {} },
  PrismaIdempotencyStore: class {},
}));

const ADMIN = "admin-1";
const command = {
  proposalId: "5",
  decision: "ACCEPTED" as const,
  publicReason: "ok",
  privateNote: null,
  claimOutcomes: [{ claimId: "11", outcome: "ACEPTADA" as const, reason: "procedencia" }],
  idempotencyKey: "k1",
};

function harness(opts: { write: "created" | "recovered" | "p2002" | "boom"; recovery?: ResolutionState | null }) {
  const loadState = vi.fn().mockResolvedValue(opts.recovery ?? null);
  let committed: ResolveOutcome | null = null;
  const resolve = vi.fn(async (seed: { proposalId: number }) => {
    if (opts.write === "p2002") throw new ProposalAlreadyExistsError("5");
    if (opts.write === "boom") throw new Error("boom");
    committed =
      opts.write === "created"
        ? { proposalId: seed.proposalId, resolutionRecordId: 42, proposalStatus: "ACEPTADA", recovered: false }
        : { proposalId: seed.proposalId, resolutionRecordId: 42, proposalStatus: "ACEPTADA", recovered: true };
    return committed;
  });
  const read = { loadResolutionState: loadState };
  const write = { resolve };
  const io = { read, transaction: { run: (fn: (x: { read: unknown; write: unknown }) => Promise<unknown>) => fn({ read, write }) } };
  const getCommittedResult = vi.fn((): ResolveOutcome => {
    if (!committed) throw new CommittedResultUnavailableError();
    return { ...committed };
  });
  return { ioHandle: { io, getCommittedResult } as unknown as ResolveIO, resolve, loadState, getCommittedResult };
}

const state = (o: Partial<ResolutionState["resolution"]> = {}): ResolutionState => ({
  resolution: { id: 42, outcome: "ACEPTADA", publicReason: "ok", privateNote: null, ...o },
  claims: [{ id: 11, result: "ACEPTADA", resultReason: "procedencia" }],
});

describe("resolveCatalogProposalUseCase — idempotencia (orquestación)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creación nueva → recovered:false, appliedToCatalog:false, ids stringificados", async () => {
    const h = harness({ write: "created" });
    vi.mocked(prismaResolveIO).mockReturnValue(h.ioHandle);
    const r = await resolveCatalogProposalUseCase(command, ADMIN);
    expect(r).toEqual({ proposalId: "5", resolutionRecordId: "42", proposalStatus: "ACEPTADA", appliedToCatalog: false, recovered: false });
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.getCommittedResult).toHaveBeenCalledTimes(1);
  });

  it("replay bajo lock → recovered:true", async () => {
    const h = harness({ write: "recovered" });
    vi.mocked(prismaResolveIO).mockReturnValue(h.ioHandle);
    const r = await resolveCatalogProposalUseCase(command, ADMIN);
    expect(r).toEqual({ proposalId: "5", resolutionRecordId: "42", proposalStatus: "ACEPTADA", appliedToCatalog: false, recovered: true });
  });

  it("carrera P2002 compatible → recovered:true", async () => {
    const h = harness({ write: "p2002", recovery: state() });
    vi.mocked(prismaResolveIO).mockReturnValue(h.ioHandle);
    const r = await resolveCatalogProposalUseCase(command, ADMIN);
    expect(r).toEqual({ proposalId: "5", resolutionRecordId: "42", proposalStatus: "ACEPTADA", appliedToCatalog: false, recovered: true });
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("carrera P2002 incompatible → IdempotencyConflictError", async () => {
    const h = harness({ write: "p2002", recovery: state({ outcome: "RECHAZADA" }) });
    vi.mocked(prismaResolveIO).mockReturnValue(h.ioHandle);
    await expect(resolveCatalogProposalUseCase(command, ADMIN)).rejects.toThrow(IdempotencyConflictError);
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("error no relacionado se propaga", async () => {
    const h = harness({ write: "boom" });
    vi.mocked(prismaResolveIO).mockReturnValue(h.ioHandle);
    let caught: unknown;
    try { await resolveCatalogProposalUseCase(command, ADMIN); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(IdempotencyConflictError);
    expect((caught as Error).message).toBe("boom");
    expect(h.loadState).not.toHaveBeenCalled();
  });
});
