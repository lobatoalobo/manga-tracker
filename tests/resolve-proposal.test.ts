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
  buildResolveSeed,
  assertClaimCoverage,
  assertCompatibleResolveReplay,
  fingerprintOfSeed,
  sameResolveFingerprint,
  ClaimOutcomesInvalidError,
  ProposalNotResolvableError,
  ProposalNotFoundError,
  IdempotencyConflictError,
  type ExistingResolution,
  type ProposalClaimRow,
  type ResolveReadPort,
  type ResolveSeed,
  type ResolveWritePort,
} from "@/lib/domain/proposal/resolve";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { resolveWritePort } from "@/lib/infra/proposal/resolve";
import { resolveCatalogProposal } from "@/lib/contributions/mutations/resolveCatalogProposal";
import { resolveCatalogProposalAction } from "@/app/contribuciones/actions";
import { isEnabled } from "@/lib/featureFlags";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { resolveCatalogProposalUseCase } from "@/lib/contributions/resolveCatalogProposal";

vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), requireUserId: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: vi.fn(), RL: {} }));
vi.mock("@/lib/contributions/resolveCatalogProposal", async (orig) => {
  const actual = await orig<typeof import("@/lib/contributions/resolveCatalogProposal")>();
  return { ...actual, resolveCatalogProposalUseCase: vi.fn() };
});

const ADMIN = "admin-1";
const cmd = (o: Record<string, unknown> = {}) =>
  ({
    proposalId: "5",
    decision: "ACCEPTED",
    publicReason: "ok",
    privateNote: null,
    claimOutcomes: [{ claimId: "11", outcome: "ACEPTADA", reason: "procedencia" }],
    idempotencyKey: "k1",
    ...o,
  }) as never;
const seedOf = (o: Record<string, unknown> = {}): ResolveSeed => buildResolveSeed(cmd(o), ADMIN);

// ---------------------------------------------------------------------------
// Dominio
// ---------------------------------------------------------------------------
describe("dominio — validación, cobertura, huella", () => {
  it("valida decision (ACCEPTED|REJECTED)", () => {
    expect(() => buildResolveSeed(cmd({ decision: "MAYBE" }), ADMIN)).toThrow(ValidationError);
    expect(seedOf({ decision: "ACCEPTED" }).outcome).toBe("ACEPTADA");
    expect(seedOf({ decision: "REJECTED", claimOutcomes: [{ claimId: "11", outcome: "NO_USADA", reason: "rechazada" }] }).outcome).toBe("RECHAZADA");
  });

  it("exige publicReason no vacío y normaliza whitespace", () => {
    expect(() => buildResolveSeed(cmd({ publicReason: "   " }), ADMIN)).toThrow(ValidationError);
    expect(seedOf({ publicReason: "  hola   mundo  " }).publicReason).toBe("hola mundo");
  });

  it("normaliza reasons y rechaza motivo incoherente con el outcome", () => {
    expect(seedOf({ claimOutcomes: [{ claimId: "11", outcome: "ACEPTADA", reason: "  procedencia " }] }).claimOutcomes[0].resultReason).toBe("procedencia");
    expect(seedOf({ claimOutcomes: [{ claimId: "11", outcome: "NO_USADA", reason: "" }] }).claimOutcomes[0].resultReason).toBeNull();
    expect(() => buildResolveSeed(cmd({ claimOutcomes: [{ claimId: "11", outcome: "ACEPTADA", reason: "desplazada" }] }), ADMIN)).toThrow(ClaimOutcomesInvalidError);
  });

  it("rechaza claim duplicada en el comando", () => {
    expect(() =>
      buildResolveSeed(cmd({ claimOutcomes: [
        { claimId: "11", outcome: "ACEPTADA", reason: "procedencia" },
        { claimId: "11", outcome: "NO_USADA", reason: "descartada" },
      ] }), ADMIN),
    ).toThrow(ClaimOutcomesInvalidError);
  });

  it("REJECTED obliga a que toda claim termine NO_USADA", () => {
    expect(() =>
      buildResolveSeed(cmd({ decision: "REJECTED", claimOutcomes: [{ claimId: "11", outcome: "ACEPTADA", reason: "procedencia" }] }), ADMIN),
    ).toThrow(ClaimOutcomesInvalidError);
  });

  it("cobertura: claim ajena y cobertura incompleta fallan; cobertura exacta pasa", () => {
    const claims: ProposalClaimRow[] = [
      { id: 11, result: "PROPUESTA", resultReason: null },
      { id: 12, result: "PROPUESTA", resultReason: null },
    ];
    // ajena
    expect(() => assertClaimCoverage([{ claimId: 99, result: "ACEPTADA", resultReason: "procedencia" }], claims)).toThrow(ClaimOutcomesInvalidError);
    // incompleta (falta 12)
    expect(() => assertClaimCoverage([{ claimId: 11, result: "ACEPTADA", resultReason: "procedencia" }], claims)).toThrow(ClaimOutcomesInvalidError);
    // exacta
    expect(() => assertClaimCoverage([
      { claimId: 11, result: "ACEPTADA", resultReason: "procedencia" },
      { claimId: 12, result: "NO_USADA", resultReason: "descartada" },
    ], claims)).not.toThrow();
    // claims ya terminales no cuentan como cobertura pendiente
    expect(() => assertClaimCoverage([], [{ id: 11, result: "ACEPTADA", resultReason: "procedencia" }])).not.toThrow();
  });

  it("fingerprint determinista (independiente del orden recibido)", () => {
    const a = fingerprintOfSeed(seedOf({ claimOutcomes: [
      { claimId: "11", outcome: "ACEPTADA", reason: "procedencia" },
      { claimId: "12", outcome: "NO_USADA", reason: "descartada" },
    ] }));
    const b = fingerprintOfSeed(seedOf({ claimOutcomes: [
      { claimId: "12", outcome: "NO_USADA", reason: "descartada" },
      { claimId: "11", outcome: "ACEPTADA", reason: "procedencia" },
    ] }));
    expect(sameResolveFingerprint(a, b)).toBe(true);
    expect(a.claimsKey).toBe(b.claimsKey);
  });

  const resolution = (o: Partial<ExistingResolution> = {}): ExistingResolution => ({ id: 42, outcome: "ACEPTADA", publicReason: "ok", privateNote: null, ...o });
  const persisted: ProposalClaimRow[] = [{ id: 11, result: "ACEPTADA", resultReason: "procedencia" }];

  it("replay compatible no lanza; incompatible → IdempotencyConflictError", () => {
    expect(() => assertCompatibleResolveReplay(seedOf(), resolution(), persisted)).not.toThrow();
    // distinto publicReason
    expect(() => assertCompatibleResolveReplay(seedOf(), resolution({ publicReason: "otro" }), persisted)).toThrow(IdempotencyConflictError);
    // distinto outcome
    expect(() => assertCompatibleResolveReplay(seedOf(), resolution({ outcome: "RECHAZADA" }), persisted)).toThrow(IdempotencyConflictError);
    // distinto resultado de claim
    expect(() => assertCompatibleResolveReplay(seedOf(), resolution(), [{ id: 11, result: "NO_USADA", resultReason: "rechazada" }])).toThrow(IdempotencyConflictError);
  });
});

// ---------------------------------------------------------------------------
// Infra write-port (tx falsa)
// ---------------------------------------------------------------------------
type FakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  resolutionRecord: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  proposalInfoRequest: { findFirst: ReturnType<typeof vi.fn> };
  proposalClaim: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  catalogProposal: { update: ReturnType<typeof vi.fn> };
};
function fakeTx(over: Partial<{
  locked: unknown[]; existingRR: unknown; existingClaims: unknown[]; openReq: unknown; claims: unknown[]; create: ReturnType<typeof vi.fn>;
}> = {}): FakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "SUBMITTED", version: 1 }]),
    resolutionRecord: {
      findUnique: vi.fn().mockResolvedValue(over.existingRR ?? null),
      create: over.create ?? vi.fn().mockResolvedValue({ id: 42 }),
    },
    proposalInfoRequest: { findFirst: vi.fn().mockResolvedValue(over.openReq ?? null) },
    proposalClaim: {
      findMany: vi.fn().mockImplementation(async () =>
        // el replay lee las claims persistidas; el alta lee las claims PROPUESTA
        over.existingRR ? (over.existingClaims ?? []) : (over.claims ?? [{ id: 11, result: "PROPUESTA", resultReason: null }]),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    catalogProposal: { update: vi.fn().mockResolvedValue({}) },
  };
}
const runResolve = (tx: FakeTx, onCommitted = vi.fn()) =>
  resolveWritePort(tx as unknown as Prisma.TransactionClient, onCommitted);

describe("infra write-port — persistencia, atomicidad, lock", () => {
  it("crea ResolutionRecord (HUMAN + moderator + reasons), resuelve claims y transiciona + version++", async () => {
    const tx = fakeTx({ claims: [
      { id: 11, result: "PROPUESTA", resultReason: null },
      { id: 12, result: "PROPUESTA", resultReason: null },
    ] });
    const onCommitted = vi.fn();
    const out = await runResolve(tx, onCommitted).resolve(seedOf({
      privateNote: "nota interna",
      claimOutcomes: [
        { claimId: "11", outcome: "ACEPTADA", reason: "procedencia" },
        { claimId: "12", outcome: "NO_USADA", reason: "descartada" },
      ],
    }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // lock
    expect(tx.resolutionRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        proposalId: 5, outcome: "ACEPTADA", actorType: "HUMAN",
        moderatorUserId: ADMIN, publicReason: "ok", privateNote: "nota interna",
      }),
    }));
    // update de TODAS las claims con metadata de resolución
    expect(tx.proposalClaim.update).toHaveBeenCalledTimes(2);
    expect(tx.proposalClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 11 }, data: expect.objectContaining({ result: "ACEPTADA", resultReason: "procedencia", resolvedByUserId: ADMIN }),
    }));
    expect(tx.proposalClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12 }, data: expect.objectContaining({ result: "NO_USADA", resultReason: "descartada" }),
    }));
    // transición terminal + version++
    expect(tx.catalogProposal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 }, data: { status: "ACEPTADA", version: { increment: 1 } },
    }));
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, proposalStatus: "ACEPTADA", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
  });

  it("RECHAZADA transiciona a estado terminal RECHAZADA", async () => {
    const tx = fakeTx();
    const out = await runResolve(tx).resolve(seedOf({ decision: "REJECTED", claimOutcomes: [{ claimId: "11", outcome: "NO_USADA", reason: "rechazada" }] }));
    expect(tx.catalogProposal.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "RECHAZADA", version: { increment: 1 } } }));
    expect(out.proposalStatus).toBe("RECHAZADA");
  });

  it("replay (misma huella): recupera, NO crea RR / NO resuelve claims / NO transiciona", async () => {
    const tx = fakeTx({ existingRR: { id: 42, outcome: "ACEPTADA", publicReason: "ok", privateNote: null }, existingClaims: [{ id: 11, result: "ACEPTADA", resultReason: "procedencia" }] });
    const out = await runResolve(tx).resolve(seedOf());
    expect(tx.resolutionRecord.create).not.toHaveBeenCalled();
    expect(tx.proposalClaim.update).not.toHaveBeenCalled();
    expect(tx.catalogProposal.update).not.toHaveBeenCalled();
    expect(out).toEqual({ proposalId: 5, resolutionRecordId: 42, proposalStatus: "ACEPTADA", recovered: true });
  });

  it("replay incompatible → IdempotencyConflictError, sin escribir", async () => {
    const tx = fakeTx({ existingRR: { id: 42, outcome: "RECHAZADA", publicReason: "ok", privateNote: null }, existingClaims: [{ id: 11, result: "NO_USADA", resultReason: "rechazada" }] });
    await expect(runResolve(tx).resolve(seedOf())).rejects.toThrow(IdempotencyConflictError);
    expect(tx.resolutionRecord.create).not.toHaveBeenCalled();
  });

  it("estado no SUBMITTED → ProposalNotResolvableError", async () => {
    const tx = fakeTx({ locked: [{ id: 5, status: "NEEDS_INFO", version: 1 }] });
    await expect(runResolve(tx).resolve(seedOf())).rejects.toThrow(ProposalNotResolvableError);
    expect(tx.resolutionRecord.create).not.toHaveBeenCalled();
  });

  it("con InfoRequest ABIERTO → ProposalNotResolvableError (no lo cierra)", async () => {
    const tx = fakeTx({ openReq: { id: 70 } });
    await expect(runResolve(tx).resolve(seedOf())).rejects.toThrow(ProposalNotResolvableError);
    expect(tx.resolutionRecord.create).not.toHaveBeenCalled();
  });

  it("propuesta inexistente (lock vacío) → ProposalNotFoundError", async () => {
    await expect(runResolve(fakeTx({ locked: [] })).resolve(seedOf())).rejects.toThrow(ProposalNotFoundError);
  });

  it("cobertura incompleta en persistencia → ClaimOutcomesInvalidError, sin crear RR", async () => {
    const tx = fakeTx({ claims: [
      { id: 11, result: "PROPUESTA", resultReason: null },
      { id: 12, result: "PROPUESTA", resultReason: null },
    ] });
    await expect(runResolve(tx).resolve(seedOf())).rejects.toThrow(ClaimOutcomesInvalidError);
    expect(tx.resolutionRecord.create).not.toHaveBeenCalled();
  });

  it("P2002 en create → ProposalAlreadyExistsError, sin resolver claims ni transicionar", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["ResolutionRecord_proposalId_key"] } });
    const tx = fakeTx({ create: vi.fn().mockRejectedValue(p2002) });
    await expect(runResolve(tx).resolve(seedOf())).rejects.toThrow(ProposalAlreadyExistsError);
    expect(tx.proposalClaim.update).not.toHaveBeenCalled();
    expect(tx.catalogProposal.update).not.toHaveBeenCalled();
  });

  it("rollback: un error en la transición propaga y NO captura (onCommitted)", async () => {
    const tx = fakeTx();
    tx.catalogProposal.update.mockRejectedValue(new Error("boom"));
    const onCommitted = vi.fn();
    await expect(runResolve(tx, onCommitted).resolve(seedOf())).rejects.toThrow("boom");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("lock: adquiere el lock de CatalogProposal ANTES de leer/crear (mismo orden que los demás slices)", async () => {
    const tx = fakeTx();
    await runResolve(tx).resolve(seedOf());
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.resolutionRecord.create.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.proposalClaim.findMany.mock.invocationCallOrder[0]);
  });
});

// ---------------------------------------------------------------------------
// Mutation Framework — audit
// ---------------------------------------------------------------------------
describe("mutación resolveCatalogProposal — audit", () => {
  function spySink() {
    const entries: AuditEntry[] = [];
    const sink: AuditSink = { record: async (e) => void entries.push(e) };
    return { entries, sink };
  }
  const actor: Actor = { type: "admin", id: ADMIN };

  it("audita success con kind CONTRIB_RESOLVE_PROPOSAL, affected correcto y sin privateNote", async () => {
    const seed = buildResolveSeed(cmd({ privateNote: "SENSITIVE_NOTE", claimOutcomes: [{ claimId: "11", outcome: "NO_USADA", reason: "rechazada" }] }), ADMIN);
    const write: ResolveWritePort = { resolve: vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, proposalStatus: "ACEPTADA", recovered: false }) };
    const read: ResolveReadPort = { loadResolutionState: vi.fn() };
    const tx: TransactionRunner<ResolveReadPort, ResolveWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(resolveCatalogProposal, seed, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.kind).toBe("CONTRIB_RESOLVE_PROPOSAL");
    expect(success.affected).toEqual({ creates: 1, updates: 2, deletes: 0, entities: ["ResolutionRecord", "ProposalClaim", "CatalogProposal"] });
    expect(JSON.stringify(spy.entries)).not.toContain("SENSITIVE_NOTE");
  });

  it("recovered → affected en cero", async () => {
    const write: ResolveWritePort = { resolve: vi.fn().mockResolvedValue({ proposalId: 5, resolutionRecordId: 42, proposalStatus: "ACEPTADA", recovered: true }) };
    const read: ResolveReadPort = { loadResolutionState: vi.fn() };
    const tx: TransactionRunner<ResolveReadPort, ResolveWritePort> = { run: (fn) => fn({ read, write }) };
    const r = await runMutation(resolveCatalogProposal, seedOf(), { read, transaction: tx, actor, dryRun: false });
    expect(r.affected).toEqual({ creates: 0, updates: 0, deletes: 0 });
  });
});

// ---------------------------------------------------------------------------
// Action wrapper
// ---------------------------------------------------------------------------
describe("resolveCatalogProposalAction", () => {
  const GENERIC = "No se pudo procesar la resolución.";
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(auth).mockResolvedValue({ user: { id: ADMIN, email: "a@b.com" } } as never);
    vi.mocked(isAdmin).mockReturnValue(true);
    vi.mocked(resolveCatalogProposalUseCase).mockResolvedValue({ proposalId: "5", resolutionRecordId: "42", proposalStatus: "ACEPTADA", appliedToCatalog: false, recovered: false });
  });

  it("flag off → genérico, sin use-case", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    expect(await resolveCatalogProposalAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(resolveCatalogProposalUseCase).not.toHaveBeenCalled();
  });

  it("no-admin / anónimo → genérico, sin use-case", async () => {
    vi.mocked(isAdmin).mockReturnValue(false);
    expect(await resolveCatalogProposalAction(cmd())).toEqual({ ok: false, error: GENERIC });
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await resolveCatalogProposalAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(resolveCatalogProposalUseCase).not.toHaveBeenCalled();
  });

  it("admin → ok con appliedToCatalog:false explícito", async () => {
    expect(await resolveCatalogProposalAction(cmd())).toEqual({ ok: true, proposalId: "5", resolutionRecordId: "42", proposalStatus: "ACEPTADA", appliedToCatalog: false, recovered: false });
  });

  it("propuesta inexistente → genérico (anti-enumeración)", async () => {
    vi.mocked(resolveCatalogProposalUseCase).mockRejectedValueOnce(new ProposalNotFoundError());
    expect(await resolveCatalogProposalAction(cmd())).toEqual({ ok: false, error: GENERIC });
  });

  it("errores operativos → mensaje específico", async () => {
    vi.mocked(resolveCatalogProposalUseCase).mockRejectedValueOnce(new ProposalNotResolvableError("NEEDS_INFO"));
    expect((await resolveCatalogProposalAction(cmd()) as { ok: false; error: string }).error).toContain("resolución");
    vi.mocked(resolveCatalogProposalUseCase).mockRejectedValueOnce(new ClaimOutcomesInvalidError("Cobertura incompleta: falta resolver alguna claim PROPUESTA."));
    expect((await resolveCatalogProposalAction(cmd()) as { ok: false; error: string }).error).toContain("Cobertura");
    vi.mocked(resolveCatalogProposalUseCase).mockRejectedValueOnce(new IdempotencyConflictError("La propuesta ya fue resuelta de una forma distinta."));
    expect((await resolveCatalogProposalAction(cmd()) as { ok: false; error: string }).error).toContain("resuelta");
  });
});

// ---------------------------------------------------------------------------
// Concurrencia (modelado sobre el lock de CatalogProposal)
// ---------------------------------------------------------------------------
describe("concurrencia — el lock de CatalogProposal serializa la resolución", () => {
  it("dos resoluciones simultáneas: la segunda ve el ResolutionRecord y recupera (no doble create)", async () => {
    // primera gana
    const tx1 = fakeTx();
    const out1 = await runResolve(tx1).resolve(seedOf());
    expect(out1.recovered).toBe(false);
    expect(tx1.resolutionRecord.create).toHaveBeenCalledTimes(1);
    // segunda entra bajo el lock y encuentra la resolución ya escrita
    const tx2 = fakeTx({ existingRR: { id: 42, outcome: "ACEPTADA", publicReason: "ok", privateNote: null }, existingClaims: [{ id: 11, result: "ACEPTADA", resultReason: "procedencia" }] });
    const out2 = await runResolve(tx2).resolve(seedOf());
    expect(out2.recovered).toBe(true);
    expect(tx2.resolutionRecord.create).not.toHaveBeenCalled();
  });

  it("resolución simultánea con RequestInfo/AnswerInfo: mismo lock (CatalogProposal FOR UPDATE) y NO toca entidades del catálogo", async () => {
    // La tx falsa NO expone work/edition/volume: si el código intentara bloquear/escribir
    // el catálogo, fallaría. Que complete demuestra que solo usa el lock de CatalogProposal.
    const tx = fakeTx();
    await expect(runResolve(tx).resolve(seedOf())).resolves.toBeDefined();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // único lock, sobre CatalogProposal
    expect(Object.keys(tx)).not.toContain("work");
    expect(Object.keys(tx)).not.toContain("edition");
    expect(Object.keys(tx)).not.toContain("volume");
  });
});
