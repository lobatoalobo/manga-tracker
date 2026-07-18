import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runMutation,
  ValidationError,
  type Actor,
  type AuditEntry,
  type AuditSink,
  type TransactionRunner,
} from "@/lib/mutations";
import {
  buildContributionSeed,
  validateInputShape,
  normalizeClaims,
  claimSetFingerprint,
  sameClaimSet,
  ProposalNotOpenError,
  type AddContributionReadPort,
  type AddContributionSeed,
  type AddContributionWritePort,
  type AddProposalContributionInput,
  type ProposalForContribution,
  type PersistedClaim,
} from "@/lib/domain/proposal/addContribution";
import { addProposalContribution } from "@/lib/contributions/mutations/addProposalContribution";
import { isEnabled } from "@/lib/featureFlags";
import { requireUserId } from "@/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { addProposalContributionUseCase } from "@/lib/contributions/addContribution";
import { addContributionAction } from "@/app/contribuciones/actions";

// --- mocks para los tests de la server action ---
vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: vi.fn(),
  RL: {
    createProposal: { limit: 10, windowMs: 3_600_000 },
    addContribution: { limit: 20, windowMs: 3_600_000 },
  },
}));
vi.mock("@/lib/contributions/addContribution", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/contributions/addContribution")>();
  return { ...actual, addProposalContributionUseCase: vi.fn() };
});

const USER = "user-abc";
const openProposal = (o: Partial<ProposalForContribution> = {}): ProposalForContribution => ({
  id: 5, status: "SUBMITTED", contentClass: "MANGA", targetKind: "WORK", family: "CORRECCION", ...o,
});
function fakeRead(proposal: ProposalForContribution | null): AddContributionReadPort {
  return {
    loadProposalForContribution: async () => proposal,
    findContributionByIdempotencyKey: async () => null,
  };
}
const workClaim = {
  attributeKind: "TITLE_LOCALIZED", contractVersion: 1,
  claimOperation: "SET" as const, value: { language: "es", text: "x" },
};
const input = (o: Partial<AddProposalContributionInput> = {}): AddProposalContributionInput => ({
  proposalId: 5, createIdempotencyKey: "key-1", claims: [workClaim], ...o,
});

describe("validateInputShape — estructura de claims", () => {
  it("acepta un claim SET válido", () => {
    expect(() => validateInputShape(input())).not.toThrow();
  });
  it("rechaza contribución sin claims (≥1 obligatorio)", () => {
    expect(() => validateInputShape(input({ claims: [] }))).toThrow(ValidationError);
  });
  it("rechaza SET sin value", () => {
    expect(() => validateInputShape(input({
      claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: null }],
    }))).toThrow(ValidationError);
  });
  it("rechaza MARK_UNKNOWN con value", () => {
    expect(() => validateInputShape(input({
      claims: [{ attributeKind: "START_DATE", contractVersion: 1, claimOperation: "MARK_UNKNOWN", value: { x: 1 } }],
    }))).toThrow(ValidationError);
  });
  it("acepta MARK_NOT_APPLICABLE sin value", () => {
    expect(() => validateInputShape(input({
      claims: [{ attributeKind: "END_DATE", contractVersion: 1, claimOperation: "MARK_NOT_APPLICABLE", value: null }],
    }))).not.toThrow();
  });
  it("rechaza attributeKind desconocido", () => {
    expect(() => validateInputShape(input({
      claims: [{ attributeKind: "FOO", contractVersion: 1, claimOperation: "SET", value: 1 }],
    }))).toThrow(ValidationError);
  });
  it("rechaza claimOperation inválido", () => {
    expect(() => validateInputShape(input({
      claims: [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "FOO" as never, value: 1 }],
    }))).toThrow(ValidationError);
  });
});

describe("buildContributionSeed — apertura y nivel", () => {
  it("propuesta abierta (SUBMITTED) + claim Work-level → seed", async () => {
    const seed = await buildContributionSeed(fakeRead(openProposal()), input(), USER);
    expect(seed.authorId).toBe(USER);
    expect(seed.proposalId).toBe(5);
    expect(seed.claims).toHaveLength(1);
    expect(seed.claims[0].value).toEqual({ language: "es", text: "x" });
  });
  it("propuesta NEEDS_INFO también acepta", async () => {
    await expect(buildContributionSeed(fakeRead(openProposal({ status: "NEEDS_INFO" })), input(), USER))
      .resolves.toBeDefined();
  });
  it("propuesta terminal → ProposalNotOpenError", async () => {
    await expect(buildContributionSeed(fakeRead(openProposal({ status: "ACEPTADA" })), input(), USER))
      .rejects.toThrow(ProposalNotOpenError);
  });
  it("propuesta inexistente → ValidationError", async () => {
    await expect(buildContributionSeed(fakeRead(null), input(), USER)).rejects.toThrow(ValidationError);
  });
  it("nivel incompatible (VOLUME_ISBN en propuesta WORK) → ValidationError", async () => {
    await expect(buildContributionSeed(
      fakeRead(openProposal({ targetKind: "WORK" })),
      input({ claims: [{ attributeKind: "VOLUME_ISBN", contractVersion: 1, claimOperation: "SET", value: "978..." }] }),
      USER,
    )).rejects.toThrow(ValidationError);
  });
  it("Volume-kind en propuesta VOLUME → válido", async () => {
    const seed = await buildContributionSeed(
      fakeRead(openProposal({ targetKind: "VOLUME" })),
      input({ claims: [{ attributeKind: "VOLUME_ISBN", contractVersion: 1, claimOperation: "SET", value: "978..." }] }),
      USER,
    );
    expect(seed.claims[0].attributeKind).toBe("VOLUME_ISBN");
  });
});

describe("normalizeClaims + huella de idempotencia", () => {
  it("MARK_* normaliza value a null; SET conserva value", () => {
    const out = normalizeClaims([
      { attributeKind: "START_DATE", contractVersion: 1, claimOperation: "MARK_UNKNOWN", value: undefined },
      { attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { t: 1 } },
    ]);
    expect(out[0].value).toBeNull();
    expect(out[1].value).toEqual({ t: 1 });
  });
  it("huella es insensible al orden de claims", () => {
    const a: PersistedClaim[] = [
      { attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { t: 1 } },
      { attributeKind: "WORK_TYPE", contractVersion: 1, claimOperation: "SET", value: "MANGA" },
    ];
    const b: PersistedClaim[] = [a[1], a[0]];
    expect(sameClaimSet(a, b)).toBe(true);
    expect(claimSetFingerprint(a)).toBe(claimSetFingerprint(b));
  });
  it("sets de claims distintos → huella distinta (replay incompatible)", () => {
    const a: PersistedClaim[] = [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { t: 1 } }];
    const b: PersistedClaim[] = [{ attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { t: 2 } }];
    expect(sameClaimSet(a, b)).toBe(false);
  });
});

describe("addProposalContribution — contrato del framework (audit + atómico)", () => {
  function spySink() {
    const entries: AuditEntry[] = [];
    const sink: AuditSink = { record: async (e) => void entries.push(e) };
    return { entries, sink };
  }
  it("ejecuta: crea contribución + claims vía write-port y audita success", async () => {
    const read = fakeRead(openProposal());
    let written: AddContributionSeed | null = null;
    const write: AddContributionWritePort = {
      insertContributionWithClaims: async (seed) => {
        written = seed;
        return { proposalId: seed.proposalId, contributionId: 99 };
      },
    };
    const tx: TransactionRunner<AddContributionReadPort, AddContributionWritePort> = {
      run: (fn) => fn({ read, write }),
    };
    const actor: Actor = { type: "user", id: USER };
    const spy = spySink();

    const r = await runMutation(addProposalContribution, input(), {
      read, transaction: tx, actor, dryRun: false, audit: spy.sink,
    });

    expect(r.dryRun).toBe(false);
    expect(written).not.toBeNull();
    expect(written!.claims).toHaveLength(1);
    expect(written!.authorId).toBe(USER);
    expect(spy.entries.map((e) => e.phase)).toContain("success");
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.kind).toBe("CONTRIB_ADD_CONTRIBUTION");
    expect(success.affected).toEqual({
      creates: 2, updates: 0, deletes: 0, entities: ["ProposalContribution", "ProposalClaim"],
    });
  });
});

describe("addContributionAction — flag, auth, rate limit y mapeo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("feature flag off → no disponible, no llama al use-case", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    const r = await addContributionAction(input());
    expect(r.ok).toBe(false);
    expect(addProposalContributionUseCase).not.toHaveBeenCalled();
  });
  it("no autenticado → pide iniciar sesión", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(requireUserId).mockRejectedValue(new Error("No autenticado"));
    const r = await addContributionAction(input());
    expect(r.ok).toBe(false);
  });
  it("rate-limited → error del limiter", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(requireUserId).mockResolvedValue(USER);
    vi.mocked(enforceRateLimit).mockResolvedValue({ ok: false, error: "Demasiados intentos." });
    const r = await addContributionAction(input());
    expect(r).toEqual({ ok: false, error: "Demasiados intentos." });
  });
  it("happy path → ok + resultado del use-case", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(requireUserId).mockResolvedValue(USER);
    vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
    vi.mocked(addProposalContributionUseCase).mockResolvedValue({
      proposalId: "5", contributionId: "99", recovered: false,
    });
    const r = await addContributionAction(input());
    expect(r).toEqual({ ok: true, proposalId: "5", contributionId: "99", recovered: false });
  });
  it("ProposalNotOpenError → {ok:false} con mensaje de cerrada", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(requireUserId).mockResolvedValue(USER);
    vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
    vi.mocked(addProposalContributionUseCase).mockRejectedValue(new ProposalNotOpenError("ACEPTADA"));
    const r = await addContributionAction(input());
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toContain("cerrada");
  });
});
