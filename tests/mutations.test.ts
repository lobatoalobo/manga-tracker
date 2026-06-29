import { describe, it, expect, vi } from "vitest";
import {
  defineMutation,
  runMutation,
  PolicyError,
  ValidationError,
  ConfirmationRequiredError,
  type AuditEntry,
  type AuditSink,
  type Actor,
  type RunOptions,
  type TransactionRunner,
  type MutationDefinition,
  type AffectedCounts,
} from "@/lib/mutations";

// --- dobles de prueba: testeamos el CONTRATO, no las implementaciones reales ---
const fakeDb = { tag: "db" };
const txRunner: TransactionRunner = {
  run: (fn) => fn({ read: { tag: "tx" }, write: { client: { tag: "tx" }, lock: async () => {} } }),
};
const actor: Actor = { type: "script", id: "test" };

function spySink() {
  const entries: AuditEntry[] = [];
  const sink: AuditSink = { record: async (e) => void entries.push(e) };
  return { entries, sink };
}
function opts(over: Partial<RunOptions> = {}): RunOptions {
  return { actor, read: fakeDb, transaction: txRunner, ...over };
}
const counts = (c = 0, u = 0, d = 0): AffectedCounts => ({ creates: c, updates: u, deletes: d });
const prev = (affected: AffectedCounts) => ({
  affected, irreversible: false, summary: { domain: "test", human: "" }, plan: undefined,
});
function def(over: Partial<MutationDefinition<{ n: number }>> = {}) {
  return defineMutation<{ n: number }>({
    name: "example", definitionVersion: 1, kind: "TEST",
    execute: async () => {}, ...over,
  });
}

describe("Mutation Framework — pipeline", () => {
  it("dry-run es el DEFAULT: no ejecuta, audita 'attempt'", async () => {
    const execute = vi.fn(async () => {});
    const { entries, sink } = spySink();
    const r = await runMutation(def({ execute }), { n: 1 }, opts({ audit: sink }));
    expect(execute).not.toHaveBeenCalled();
    expect(r.dryRun).toBe(true);
    expect(entries.map((e) => e.phase)).toEqual(["attempt"]);
  });

  it("validate rechaza aunque afecte 0 filas (invariante de dominio)", async () => {
    const execute = vi.fn(async () => {});
    const validate = () => { throw new ValidationError("series distintas"); };
    await expect(
      runMutation(def({ validate, execute }), { n: 1 }, opts({ dryRun: false })),
    ).rejects.toThrow(ValidationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("circuit-breaker: aborta antes de ejecutar si supera el límite", async () => {
    const execute = vi.fn(async () => {});
    const d = def({
      execute,
      policy: { maxDeletes: 1 },
      preview: async () => prev(counts(0, 0, 5)),
    });
    await expect(runMutation(d, { n: 1 }, opts({ dryRun: false }))).rejects.toThrow(PolicyError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("preview es OPCIONAL: la policy cae a la metadata declarada", async () => {
    const d = def({ policy: { maxAffected: 3 } }); // sin preview
    await expect(
      runMutation(d, { n: 1 }, opts({ dryRun: false, metadata: { affected: counts(0, 10, 0) } })),
    ).rejects.toThrow(PolicyError);
  });

  it("confirmación requerida y no provista → ConfirmationRequiredError", async () => {
    const d = def({ policy: { requiresConfirmation: "always" } });
    await expect(runMutation(d, { n: 1 }, opts({ dryRun: false }))).rejects.toThrow(
      ConfirmationRequiredError,
    );
  });

  it("idempotencia: si ya se ejecutó → skip, no ejecuta", async () => {
    const execute = vi.fn(async () => {});
    const { entries, sink } = spySink();
    const d = def({ execute, idempotency: () => ({ key: "k1" }) });
    const r = await runMutation(d, { n: 1 }, opts({
      dryRun: false, audit: sink,
      idempotencyStore: { wasExecuted: async () => true },
    }));
    expect(r.skipped).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(entries.map((e) => e.phase)).toEqual(["skipped"]);
  });

  it("R1: re-valida DENTRO de la transacción (validate corre 2 veces al ejecutar)", async () => {
    const validate = vi.fn(() => {});
    await runMutation(def({ validate }), { n: 1 }, opts({ dryRun: false }));
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("excepción inesperada en execute: audita 'failure', no pierde el error, conserva correlationId", async () => {
    const { entries, sink } = spySink();
    const d = def({ execute: async () => { throw new Error("boom"); } });
    await expect(
      runMutation(d, { n: 1 }, opts({ dryRun: false, audit: sink, correlationId: "cid-X" })),
    ).rejects.toThrow("boom"); // se re-lanza tal cual, sin envolver
    const fail = entries.find((e) => e.phase === "failure");
    expect(fail?.error).toEqual({ name: "Error", message: "boom" });
    expect(fail?.correlationId).toBe("cid-X");
  });

  // CONTRATO explícito (v1): preview orientativo. Si execute hace más de lo
  // previsto, se AUDITA como warning pero NO aborta. Si esto cambia, romper acá.
  it("mismatch preview(10)/execute(12): success + warning, NO aborta", async () => {
    const { entries, sink } = spySink();
    const d = def({
      preview: async () => prev(counts(0, 10, 0)),
      execute: async () => ({ affected: counts(0, 12, 0) }),
    });
    const r = await runMutation(d, { n: 1 }, opts({ dryRun: false, audit: sink }));
    expect(r.skipped).toBe(false);
    const ok = entries.find((e) => e.phase === "success");
    expect(ok?.affected).toEqual(counts(0, 12, 0));
    expect(ok?.warnings?.some((w) => w.includes("preview estimó"))).toBe(true);
  });

  it("contrato de auditoría: el AuditSink recibe 'success' al ejecutar (no importa la impl)", async () => {
    const { entries, sink } = spySink();
    await runMutation(def(), { n: 1 }, opts({ dryRun: false, audit: sink }));
    expect(entries.map((e) => e.phase)).toContain("success");
  });
});
