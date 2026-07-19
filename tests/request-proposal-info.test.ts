import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
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
  buildRequestInfoSeed,
  normalizeMessage,
  normalizePrivateNote,
  assertRequestableForNew,
  assertCompatibleInfoReplay,
  fingerprintOfSeed,
  fingerprintOfExisting,
  sameInfoFingerprint,
  ProposalNotRequestableError,
  OpenRequestExistsError,
  ProposalNotFoundError,
  IdempotencyConflictError,
  type ExistingInfoRequest,
  type RequestInfoReadPort,
  type RequestInfoSeed,
  type RequestInfoWritePort,
} from "@/lib/domain/proposal/requestInfo";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { requestInfoWritePort } from "@/lib/infra/proposal/requestInfo";
import { requestProposalInfo } from "@/lib/contributions/mutations/requestProposalInfo";
import { requestProposalInfoAction } from "@/app/contribuciones/actions";
import { isEnabled } from "@/lib/featureFlags";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { requestProposalInfoUseCase } from "@/lib/contributions/requestProposalInfo";

// Mocks para los tests de la action.
vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), requireUserId: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: vi.fn(), RL: {} }));
vi.mock("@/lib/contributions/requestProposalInfo", async (orig) => {
  const actual = await orig<typeof import("@/lib/contributions/requestProposalInfo")>();
  return { ...actual, requestProposalInfoUseCase: vi.fn() };
});

const MOD = "mod-1";
const cmd = (o: Partial<{ proposalId: string; publicMessage: string; privateNote: string | null; idempotencyKey: string }> = {}) => ({
  proposalId: "5", publicMessage: "hola", privateNote: null as string | null, idempotencyKey: "k1", ...o,
});
const seedOf = (o = {}) => buildRequestInfoSeed(cmd(o), MOD);

describe("dominio — normalización y validación", () => {
  it("normaliza whitespace interno de publicMessage", () => {
    expect(normalizeMessage("  hola   mundo\n\ttab  ")).toBe("hola mundo tab");
  });
  it("rechaza mensaje vacío", () => {
    expect(() => buildRequestInfoSeed(cmd({ publicMessage: "   " }), MOD)).toThrow(ValidationError);
  });
  it("rechaza mensaje > 2000", () => {
    expect(() => buildRequestInfoSeed(cmd({ publicMessage: "a".repeat(2001) }), MOD)).toThrow(ValidationError);
  });
  it("normaliza nota privada; vacía → null", () => {
    expect(normalizePrivateNote("  a   b  ")).toBe("a b");
    expect(normalizePrivateNote("   ")).toBeNull();
    expect(normalizePrivateNote(null)).toBeNull();
    expect(normalizePrivateNote(undefined)).toBeNull();
  });
  it("rechaza nota privada > 2000", () => {
    expect(() => buildRequestInfoSeed(cmd({ privateNote: "a".repeat(2001) }), MOD)).toThrow(ValidationError);
  });
  it("proposalId inválido / key faltante → ValidationError", () => {
    expect(() => buildRequestInfoSeed(cmd({ proposalId: "0" }), MOD)).toThrow(ValidationError);
    expect(() => buildRequestInfoSeed(cmd({ idempotencyKey: "  " }), MOD)).toThrow(ValidationError);
  });
  it("seed válido: prompt normalizado, proposalId int, openedByUserId", () => {
    const s = buildRequestInfoSeed(cmd({ publicMessage: "  hola  mundo " }), MOD);
    expect(s).toEqual({ proposalId: 5, prompt: "hola mundo", privateNote: null, idempotencyKey: "k1", openedByUserId: MOD });
  });
});

describe("dominio — transición e idempotencia", () => {
  it("SUBMITTED permite nueva; terminal → NotRequestable; NEEDS_INFO → OpenRequestExists", () => {
    expect(() => assertRequestableForNew("SUBMITTED")).not.toThrow();
    expect(() => assertRequestableForNew("ACEPTADA")).toThrow(ProposalNotRequestableError);
    expect(() => assertRequestableForNew("RECHAZADA")).toThrow(ProposalNotRequestableError);
    expect(() => assertRequestableForNew("NEEDS_INFO")).toThrow(OpenRequestExistsError);
  });
  const existing = (o: Partial<ExistingInfoRequest> = {}): ExistingInfoRequest => ({
    infoRequestId: 77, proposalId: 5, scope: "PROPOSAL", targetUserId: null,
    targetContributionId: null, prompt: "hola", privateNote: null, ...o,
  });
  it("huella igual (incluye whitespace normalizado) → compatible", () => {
    const s = buildRequestInfoSeed(cmd({ publicMessage: "hola  " }), MOD); // normaliza a "hola"
    expect(sameInfoFingerprint(fingerprintOfSeed(s), fingerprintOfExisting(existing()))).toBe(true);
    expect(() => assertCompatibleInfoReplay(s, existing())).not.toThrow();
  });
  it("distinto prompt → conflicto", () => {
    expect(() => assertCompatibleInfoReplay(seedOf(), existing({ prompt: "otro" }))).toThrow(IdempotencyConflictError);
  });
  it("distinta privateNote → conflicto", () => {
    const s = buildRequestInfoSeed(cmd({ privateNote: "nota" }), MOD);
    expect(() => assertCompatibleInfoReplay(s, existing({ privateNote: null }))).toThrow(IdempotencyConflictError);
  });
  it("misma key en otra propuesta → conflicto", () => {
    expect(() => assertCompatibleInfoReplay(seedOf(), existing({ proposalId: 6 }))).toThrow(IdempotencyConflictError);
  });
});

// ---- write-port (infra) con tx falsa: persistencia + atomicidad ----
type FakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  proposalInfoRequest: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  catalogProposal: { update: ReturnType<typeof vi.fn> };
};
function fakeTx(over: Partial<{ locked: unknown[]; existingRow: unknown; openRow: unknown; create: ReturnType<typeof vi.fn> }> = {}): FakeTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue(over.locked ?? [{ id: 5, status: "SUBMITTED", version: 0 }]),
    proposalInfoRequest: {
      findUnique: vi.fn().mockResolvedValue(over.existingRow ?? null),
      findFirst: vi.fn().mockResolvedValue(over.openRow ?? null),
      create: over.create ?? vi.fn().mockResolvedValue({ id: 99 }),
    },
    catalogProposal: { update: vi.fn().mockResolvedValue({}) },
  };
}
const runWrite = (tx: FakeTx, onCommitted = vi.fn()) =>
  requestInfoWritePort(tx as unknown as Prisma.TransactionClient, onCommitted);

describe("infra write-port — persistencia y atomicidad", () => {
  it("crea InfoRequest (scope PROPOSAL, targets null, openedByUserId, prompt), transiciona y captura", async () => {
    const tx = fakeTx();
    const onCommitted = vi.fn();
    const out = await runWrite(tx, onCommitted).requestInfo(seedOf());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // lock FOR UPDATE
    expect(tx.proposalInfoRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        proposalId: 5, scope: "PROPOSAL", targetUserId: null, targetContributionId: null,
        prompt: "hola", privateNote: null, status: "ABIERTO", openedByUserId: MOD, idempotencyKey: "k1",
      }),
    }));
    expect(tx.catalogProposal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 }, data: { status: "NEEDS_INFO", version: { increment: 1 } },
    }));
    expect(out).toEqual({ proposalId: 5, infoRequestId: 99, proposalStatus: "NEEDS_INFO", recovered: false });
    expect(onCommitted).toHaveBeenCalledWith(out);
  });

  it("replay (misma key + payload): recupera, NO crea ni transiciona ni bump version", async () => {
    const tx = fakeTx({ existingRow: { id: 77, proposalId: 5, scope: "PROPOSAL", targetUserId: null, targetContributionId: null, prompt: "hola", privateNote: null } });
    const out = await runWrite(tx).requestInfo(seedOf());
    expect(tx.proposalInfoRequest.create).not.toHaveBeenCalled();
    expect(tx.catalogProposal.update).not.toHaveBeenCalled();
    expect(out).toEqual({ proposalId: 5, infoRequestId: 77, proposalStatus: "SUBMITTED", recovered: true });
  });

  it("replay incompatible → IdempotencyConflictError, sin escribir", async () => {
    const tx = fakeTx({ existingRow: { id: 77, proposalId: 5, scope: "PROPOSAL", targetUserId: null, targetContributionId: null, prompt: "OTRO", privateNote: null } });
    await expect(runWrite(tx).requestInfo(seedOf())).rejects.toThrow(IdempotencyConflictError);
    expect(tx.proposalInfoRequest.create).not.toHaveBeenCalled();
  });

  it("estado terminal → ProposalNotRequestableError, sin crear", async () => {
    const tx = fakeTx({ locked: [{ id: 5, status: "ACEPTADA", version: 3 }] });
    await expect(runWrite(tx).requestInfo(seedOf())).rejects.toThrow(ProposalNotRequestableError);
    expect(tx.proposalInfoRequest.create).not.toHaveBeenCalled();
  });

  it("NEEDS_INFO sin replay → OpenRequestExistsError", async () => {
    const tx = fakeTx({ locked: [{ id: 5, status: "NEEDS_INFO", version: 1 }] });
    await expect(runWrite(tx).requestInfo(seedOf())).rejects.toThrow(OpenRequestExistsError);
  });

  it("SUBMITTED pero ya hay una ABIERTA → OpenRequestExistsError", async () => {
    const tx = fakeTx({ openRow: { id: 70 } });
    await expect(runWrite(tx).requestInfo(seedOf())).rejects.toThrow(OpenRequestExistsError);
    expect(tx.proposalInfoRequest.create).not.toHaveBeenCalled();
  });

  it("propuesta inexistente (lock vacío) → ProposalNotFoundError", async () => {
    const tx = fakeTx({ locked: [] });
    await expect(runWrite(tx).requestInfo(seedOf())).rejects.toThrow(ProposalNotFoundError);
  });

  it("P2002 en create → ProposalAlreadyExistsError, sin transicionar", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["ProposalInfoRequest_idempotencyKey_key"] } });
    const tx = fakeTx({ create: vi.fn().mockRejectedValue(p2002) });
    await expect(runWrite(tx).requestInfo(seedOf())).rejects.toThrow(ProposalAlreadyExistsError);
    expect(tx.catalogProposal.update).not.toHaveBeenCalled();
  });

  it("error en la transición propaga y NO captura (rollback lo hace la tx real)", async () => {
    const tx = fakeTx();
    tx.catalogProposal.update.mockRejectedValue(new Error("boom"));
    const onCommitted = vi.fn();
    await expect(runWrite(tx, onCommitted).requestInfo(seedOf())).rejects.toThrow("boom");
    expect(onCommitted).not.toHaveBeenCalled();
  });
});

// ---- contrato de mutación: audit + no filtra privateNote ----
describe("mutación requestProposalInfo — audit", () => {
  function spySink() {
    const entries: AuditEntry[] = [];
    const sink: AuditSink = { record: async (e) => void entries.push(e) };
    return { entries, sink };
  }
  const actor: Actor = { type: "admin", id: MOD };

  it("audita success con kind CONTRIB_REQUEST_INFO y no expone prompt/privateNote", async () => {
    const seed = buildRequestInfoSeed(cmd({ publicMessage: "SENSITIVE_PROMPT", privateNote: "SECRET_NOTE" }), MOD);
    const write: RequestInfoWritePort = {
      requestInfo: vi.fn().mockResolvedValue({ proposalId: 5, infoRequestId: 99, proposalStatus: "NEEDS_INFO", recovered: false }),
    };
    const read: RequestInfoReadPort = { findByIdempotencyKey: vi.fn() };
    const tx: TransactionRunner<RequestInfoReadPort, RequestInfoWritePort> = { run: (fn) => fn({ read, write }) };
    const spy = spySink();
    await runMutation(requestProposalInfo, seed, { read, transaction: tx, actor, dryRun: false, audit: spy.sink });

    expect(write.requestInfo).toHaveBeenCalledWith(seed);
    const success = spy.entries.find((e) => e.phase === "success")!;
    expect(success.kind).toBe("CONTRIB_REQUEST_INFO");
    expect(success.affected).toEqual({ creates: 1, updates: 1, deletes: 0, entities: ["ProposalInfoRequest", "CatalogProposal"] });
    const dump = JSON.stringify(spy.entries);
    expect(dump).not.toContain("SENSITIVE_PROMPT");
    expect(dump).not.toContain("SECRET_NOTE");
  });

  it("recovered → affected en cero", async () => {
    const seed = seedOf();
    const write: RequestInfoWritePort = {
      requestInfo: vi.fn().mockResolvedValue({ proposalId: 5, infoRequestId: 77, proposalStatus: "NEEDS_INFO", recovered: true }),
    };
    const read: RequestInfoReadPort = { findByIdempotencyKey: vi.fn() };
    const tx: TransactionRunner<RequestInfoReadPort, RequestInfoWritePort> = { run: (fn) => fn({ read, write }) };
    const r = await runMutation(requestProposalInfo, seed, { read, transaction: tx, actor, dryRun: false });
    expect(r.affected).toEqual({ creates: 0, updates: 0, deletes: 0 });
  });
});

// ---- action: flag / auth / mapeo / anti-enumeración ----
describe("requestProposalInfoAction", () => {
  const GENERIC = "No se pudo procesar la solicitud.";
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(auth).mockResolvedValue({ user: { id: MOD, email: "admin@x.com" } } as never);
    vi.mocked(isAdmin).mockReturnValue(true);
    vi.mocked(requestProposalInfoUseCase).mockResolvedValue({ proposalId: "5", infoRequestId: "99", proposalStatus: "NEEDS_INFO", recovered: false });
  });

  it("flag off → genérico, sin use-case", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    expect(await requestProposalInfoAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(requestProposalInfoUseCase).not.toHaveBeenCalled();
  });
  it("anónimo → genérico", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await requestProposalInfoAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(requestProposalInfoUseCase).not.toHaveBeenCalled();
  });
  it("no-admin → genérico", async () => {
    vi.mocked(isAdmin).mockReturnValue(false);
    expect(await requestProposalInfoAction(cmd())).toEqual({ ok: false, error: GENERIC });
    expect(requestProposalInfoUseCase).not.toHaveBeenCalled();
  });
  it("admin → ok con resultado", async () => {
    expect(await requestProposalInfoAction(cmd())).toEqual({ ok: true, proposalId: "5", infoRequestId: "99", proposalStatus: "NEEDS_INFO", recovered: false });
  });
  it("inexistente → genérico (anti-enumeración, no filtra existencia)", async () => {
    vi.mocked(requestProposalInfoUseCase).mockRejectedValue(new ProposalNotFoundError());
    expect(await requestProposalInfoAction(cmd())).toEqual({ ok: false, error: GENERIC });
  });
  it("errores operativos → mensaje específico", async () => {
    vi.mocked(requestProposalInfoUseCase).mockRejectedValueOnce(new ProposalNotRequestableError("ACEPTADA"));
    expect((await requestProposalInfoAction(cmd()) as { ok: false; error: string }).error).toContain("no admite");
    vi.mocked(requestProposalInfoUseCase).mockRejectedValueOnce(new OpenRequestExistsError());
    expect((await requestProposalInfoAction(cmd()) as { ok: false; error: string }).error).toContain("abierta");
    vi.mocked(requestProposalInfoUseCase).mockRejectedValueOnce(new IdempotencyConflictError("La clave de idempotencia ya se usó para otra solicitud de información distinta."));
    expect((await requestProposalInfoAction(cmd()) as { ok: false; error: string }).error).toContain("idempotencia");
  });
});

// ---- migración aditiva ----
describe("migración 20260718000000_add_inforequest_idempotency_key", () => {
  const sql = readFileSync("prisma/migrations/20260718000000_add_inforequest_idempotency_key/migration.sql", "utf8");
  it("agrega la columna nullable idempotencyKey", () => {
    expect(sql).toMatch(/ADD COLUMN\s+"idempotencyKey"\s+TEXT/);
    expect(sql).not.toMatch(/idempotencyKey"\s+TEXT\s+NOT NULL/);
  });
  it("crea el índice unique", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "ProposalInfoRequest_idempotencyKey_key"/);
  });
  it("es aditiva (sin DROP/DELETE/UPDATE/backfill)", () => {
    // Ignorar comentarios (-- …) y mirar solo las sentencias SQL.
    const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(statements).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b/i);
  });
});
