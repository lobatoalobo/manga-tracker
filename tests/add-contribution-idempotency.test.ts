import { describe, it, expect, vi, beforeEach } from "vitest";
import { addProposalContributionUseCase } from "@/lib/contributions/addContribution";
import { prismaAddContributionIO } from "@/lib/infra/proposal/addContribution";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import {
  IdempotencyConflictError,
  ProposalAlreadyExistsError,
} from "@/lib/domain/proposal/create";
import type {
  AddContributionReadPort,
  AddContributionSeed,
  AddContributionWritePort,
  AddProposalContributionInput,
  ExistingContribution,
  ProposalForContribution,
} from "@/lib/domain/proposal/addContribution";
import type {
  AddContributionIO,
  CommittedContributionResult,
} from "@/lib/infra/proposal/addContribution";

// Mockeamos el IO de datos (para inyectar dobles controlables) y el audit-sink de
// Prisma (no-op: el runMutation real audita pero no debe tocar la DB).
vi.mock("@/lib/infra/proposal/addContribution", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/infra/proposal/addContribution")>();
  return { ...actual, prismaAddContributionIO: vi.fn() };
});
vi.mock("@/lib/infra/mutations", () => ({
  PrismaAuditSink: class {
    async record() {}
  },
  PrismaIdempotencyStore: class {},
}));

const USER = "user-abc";
const OPEN: ProposalForContribution = {
  id: 5, status: "SUBMITTED", contentClass: "MANGA", targetKind: "WORK", family: "CORRECCION",
};
const CLAIM = {
  attributeKind: "TITLE_LOCALIZED", contractVersion: 1,
  claimOperation: "SET" as const, value: { language: "es", text: "x" },
};
const INPUT: AddProposalContributionInput = {
  proposalId: 5, createIdempotencyKey: "key-1", claims: [CLAIM],
};
// Claims persistidas equivalentes (normalizadas) al INPUT.
const SAME_CLAIMS = [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "x" } }];
const DIFF_CLAIMS = [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "OTRO" } }];

function harness(opts: {
  preExisting?: ExistingContribution | null;
  reread?: ExistingContribution | null;
  write?: "ok" | "p2002" | "boom";
  proposal?: ProposalForContribution;
}) {
  const findByKey = vi.fn();
  findByKey.mockResolvedValueOnce(opts.preExisting ?? null);
  if (opts.reread !== undefined) findByKey.mockResolvedValueOnce(opts.reread);

  const loadProposal = vi.fn().mockResolvedValue(opts.proposal ?? OPEN);

  let committed: CommittedContributionResult | null = null;
  const insert = vi.fn(async (seed: AddContributionSeed) => {
    if (opts.write === "p2002") throw new ProposalAlreadyExistsError(seed.idempotencyKey);
    if (opts.write === "boom") throw new Error("boom");
    committed = { proposalId: seed.proposalId, contributionId: 99 };
    return committed;
  });

  const read = {
    findContributionByIdempotencyKey: findByKey,
    loadProposalForContribution: loadProposal,
  } as unknown as AddContributionReadPort;
  const write = { insertContributionWithClaims: insert } as unknown as AddContributionWritePort;

  const getCommittedResult = vi.fn((): CommittedContributionResult => {
    if (!committed) throw new CommittedResultUnavailableError();
    return { ...committed };
  });

  const io = {
    read,
    transaction: {
      run: (fn: (x: { read: AddContributionReadPort; write: AddContributionWritePort }) => Promise<unknown>) =>
        fn({ read, write }),
    },
  };
  const ioHandle = { io, getCommittedResult } as unknown as AddContributionIO;
  return { ioHandle, findByKey, loadProposal, insert, getCommittedResult };
}

const existing = (claims: ExistingContribution["claims"], o: Partial<ExistingContribution> = {}): ExistingContribution => ({
  id: 77, proposalId: 5, claims, ...o,
});

describe("addProposalContributionUseCase — idempotencia (orquestación)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1. creación nueva: ejecuta 1 escritura, usa getCommittedResult, recovered:false", async () => {
    const h = harness({ preExisting: null, write: "ok" });
    vi.mocked(prismaAddContributionIO).mockReturnValue(h.ioHandle);

    const r = await addProposalContributionUseCase(INPUT, USER);

    expect(r).toEqual({ proposalId: "5", contributionId: "99", recovered: false });
    expect(h.findByKey).toHaveBeenCalledTimes(1); // solo el pre-check
    expect(h.insert).toHaveBeenCalledTimes(1); // exactamente UNA escritura
    expect(h.getCommittedResult).toHaveBeenCalledTimes(1);
  });

  it("2. replay compatible: NO ejecuta mutación/write ni getCommittedResult, recovered:true (aun si terminal)", async () => {
    const h = harness({
      preExisting: existing(SAME_CLAIMS),
      write: "ok",
      proposal: { ...OPEN, status: "ACEPTADA" }, // terminal: no debe mirarse
    });
    vi.mocked(prismaAddContributionIO).mockReturnValue(h.ioHandle);

    const r = await addProposalContributionUseCase(INPUT, USER);

    expect(r).toEqual({ proposalId: "5", contributionId: "77", recovered: true });
    expect(h.insert).not.toHaveBeenCalled(); // CERO escrituras
    expect(h.getCommittedResult).not.toHaveBeenCalled();
    expect(h.loadProposal).not.toHaveBeenCalled(); // no revalida apertura en replay
    expect(h.findByKey).toHaveBeenCalledTimes(1);
  });

  it("3. replay incompatible: IdempotencyConflictError, sin mutación/write/getCommittedResult", async () => {
    const h = harness({ preExisting: existing(DIFF_CLAIMS), write: "ok" });
    vi.mocked(prismaAddContributionIO).mockReturnValue(h.ioHandle);

    await expect(addProposalContributionUseCase(INPUT, USER)).rejects.toThrow(IdempotencyConflictError);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("4. carrera P2002 compatible: relee, recupera al ganador, recovered:true, sin reintentar INSERT", async () => {
    const h = harness({ preExisting: null, reread: existing(SAME_CLAIMS), write: "p2002" });
    vi.mocked(prismaAddContributionIO).mockReturnValue(h.ioHandle);

    const r = await addProposalContributionUseCase(INPUT, USER);

    expect(r).toEqual({ proposalId: "5", contributionId: "77", recovered: true });
    expect(h.insert).toHaveBeenCalledTimes(1); // el INSERT perdedor; NO se reintenta
    expect(h.findByKey).toHaveBeenCalledTimes(2); // pre-check + relectura
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("5. carrera P2002 incompatible: el ganador tiene claims distintas → IdempotencyConflictError", async () => {
    const h = harness({ preExisting: null, reread: existing(DIFF_CLAIMS), write: "p2002" });
    vi.mocked(prismaAddContributionIO).mockReturnValue(h.ioHandle);

    await expect(addProposalContributionUseCase(INPUT, USER)).rejects.toThrow(IdempotencyConflictError);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });

  it("6. error no relacionado: se propaga (no se interpreta como replay), sin relectura", async () => {
    const h = harness({ preExisting: null, write: "boom" });
    vi.mocked(prismaAddContributionIO).mockReturnValue(h.ioHandle);

    let caught: unknown;
    try {
      await addProposalContributionUseCase(INPUT, USER);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(IdempotencyConflictError);
    expect((caught as Error).message).toBe("boom");
    expect(h.findByKey).toHaveBeenCalledTimes(1); // pre-check; NO relectura por P2002
    expect(h.getCommittedResult).not.toHaveBeenCalled();
  });
});
