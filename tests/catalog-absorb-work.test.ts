import { describe, it, expect } from "vitest";
import { ValidationError } from "@/lib/mutations";
import {
  absorbWorkCommand,
  isActiveWork,
  MERGE_PLAN_V1,
  ABSORB_REASON,
  type AbsorbWorkCommand,
} from "@/lib/domain/catalog/absorbWork";
import { absorbWorkInTx } from "@/lib/infra/catalog/absorbWork";

// ---------------------------------------------------------------------------
// Dominio — comando + plan
// ---------------------------------------------------------------------------
describe("dominio — comando de absorción", () => {
  it("construye un comando válido (plan v1 por default)", () => {
    expect(absorbWorkCommand({ survivingWorkId: 1, absorbedWorkId: 2 })).toEqual({ survivingWorkId: 1, absorbedWorkId: 2, mergePlan: MERGE_PLAN_V1 });
  });
  it("rechaza ids inválidos y versión de plan no soportada", () => {
    expect(() => absorbWorkCommand({ survivingWorkId: 0, absorbedWorkId: 2 })).toThrow(ValidationError);
    expect(() => absorbWorkCommand({ survivingWorkId: 1, absorbedWorkId: -1 })).toThrow(ValidationError);
    expect(() => absorbWorkCommand({ survivingWorkId: 1, absorbedWorkId: 2, mergePlan: { version: 2 } as unknown as typeof MERGE_PLAN_V1 })).toThrow(ValidationError);
  });
  it("ids iguales NO se rechazan en construcción (SAME_WORK es resultado, no malformación)", () => {
    expect(() => absorbWorkCommand({ survivingWorkId: 5, absorbedWorkId: 5 })).not.toThrow();
  });
  it("isActiveWork: activo sii absorbedIntoId es null", () => {
    expect(isActiveWork(null)).toBe(true);
    expect(isActiveWork(9)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Write-port con dobles (concurrencia real → integración)
// ---------------------------------------------------------------------------
type W = { id: number; absorbedIntoId: number | null };
type Ed = { id: number; workId: number; publisher: string; language: string };

function fakeTx(seed: { works?: W[]; editions?: Ed[] } = {}) {
  const works = new Map<number, W>((seed.works ?? []).map((w): [number, W] => [w.id, { ...w }]));
  const editions: Ed[] = (seed.editions ?? []).map((e) => ({ ...e }));
  const workUpdates: Array<{ id: number; data: Record<string, unknown> }> = [];
  let edMoves = 0;

  // Sin `$transaction` ni `catalogIdentity` a propósito: si el port intentara abrir una tx o tocar
  // identidades, fallaría → estos tests prueban que NO lo hace.
  const tx = {
    $queryRaw: async () => [],
    work: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const w = works.get(where.id);
        return w ? { id: w.id, absorbedIntoId: w.absorbedIntoId } : null;
      },
      findFirst: async ({ where }: { where: { absorbedIntoId: number } }) => {
        for (const w of works.values()) if (w.absorbedIntoId === where.absorbedIntoId) return { id: w.id };
        return null;
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const w = works.get(where.id);
        if (w) w.absorbedIntoId = data.absorbedIntoId as number;
        workUpdates.push({ id: where.id, data });
        return { id: where.id };
      },
    },
    publisherEdition: {
      findMany: async ({ where }: { where: { workId: number } }) =>
        editions.filter((e) => e.workId === where.workId).map((e) => ({ publisher: e.publisher, language: e.language })),
      updateMany: async ({ where, data }: { where: { workId: number }; data: { workId: number } }) => {
        let c = 0;
        for (const e of editions) if (e.workId === where.workId) { e.workId = data.workId; c++; }
        edMoves = c;
        return { count: c };
      },
    },
  };
  return { tx: tx as unknown as Parameters<typeof absorbWorkInTx>[0], works, editions, workUpdates, moved: () => edMoves };
}

const cmd = (s: number, a: number): AbsorbWorkCommand => absorbWorkCommand({ survivingWorkId: s, absorbedWorkId: a });

describe("write-port — absorbWorkInTx (dobles)", () => {
  it("ids iguales → SAME_WORK, sin escritura", async () => {
    const f = fakeTx({ works: [{ id: 5, absorbedIntoId: null }] });
    const r = await absorbWorkInTx(f.tx, cmd(5, 5));
    expect(r).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.SAME_WORK });
    expect(f.workUpdates).toHaveLength(0);
    expect(f.moved()).toBe(0);
  });

  it("Work inexistente → WORK_NOT_FOUND (indica cuál)", async () => {
    const f1 = fakeTx({ works: [{ id: 2, absorbedIntoId: null }] });
    expect(await absorbWorkInTx(f1.tx, cmd(1, 2))).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.WORK_NOT_FOUND, missing: "survivor" });
    const f2 = fakeTx({ works: [{ id: 1, absorbedIntoId: null }] });
    expect(await absorbWorkInTx(f2.tx, cmd(1, 2))).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.WORK_NOT_FOUND, missing: "absorbed" });
  });

  it("absorbido ya absorbido al MISMO destino → ALREADY_ABSORBED", async () => {
    const f = fakeTx({ works: [{ id: 1, absorbedIntoId: null }, { id: 2, absorbedIntoId: 1 }] });
    const r = await absorbWorkInTx(f.tx, cmd(1, 2));
    expect(r).toMatchObject({ kind: "ALREADY_ABSORBED", survivingWorkId: 1, absorbedWorkId: 2 });
    expect(f.workUpdates).toHaveLength(0); // idempotente: no reescribe
  });

  it("absorbido ya absorbido a OTRO destino → INVALID_ABSORBED_STATE", async () => {
    const f = fakeTx({ works: [{ id: 1, absorbedIntoId: null }, { id: 2, absorbedIntoId: 99 }] });
    expect(await absorbWorkInTx(f.tx, cmd(1, 2))).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.INVALID_ABSORBED_STATE });
    expect(f.workUpdates).toHaveLength(0);
  });

  it("sobreviviente absorbido → INVALID_SURVIVOR_STATE", async () => {
    const f = fakeTx({ works: [{ id: 1, absorbedIntoId: 50 }, { id: 2, absorbedIntoId: null }] });
    expect(await absorbWorkInTx(f.tx, cmd(1, 2))).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.INVALID_SURVIVOR_STATE });
  });

  it("absorbido con absorciones entrantes (cadena) → INVALID_ABSORBED_STATE", async () => {
    // 3 fue absorbido en 2; ahora se intenta absorber 2 en 1 → crearía cadena 3→2→1.
    const f = fakeTx({ works: [{ id: 1, absorbedIntoId: null }, { id: 2, absorbedIntoId: null }, { id: 3, absorbedIntoId: 2 }] });
    expect(await absorbWorkInTx(f.tx, cmd(1, 2))).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.INVALID_ABSORBED_STATE });
    expect(f.workUpdates).toHaveLength(0);
  });

  it("colisión de slot de edición (publisher+idioma) → CONTENT_CONFLICT_REQUIRES_JUDGMENT", async () => {
    const f = fakeTx({
      works: [{ id: 1, absorbedIntoId: null }, { id: 2, absorbedIntoId: null }],
      editions: [
        { id: 10, workId: 1, publisher: "Ivrea Argentina", language: "es" },
        { id: 20, workId: 2, publisher: "Ivrea Argentina", language: "es" },
      ],
    });
    const r = await absorbWorkInTx(f.tx, cmd(1, 2));
    expect(r).toMatchObject({ kind: "REJECTED", reason: ABSORB_REASON.CONTENT_CONFLICT_REQUIRES_JUDGMENT });
    if (r.kind === "REJECTED") expect(r.conflicts).toEqual([{ publisher: "Ivrea Argentina", language: "es" }]);
    expect(f.moved()).toBe(0); // sin escritura ante conflicto
  });

  it("EXECUTED: re-parenta ediciones y marca al absorbido (sin combinar hechos, sin tocar sobreviviente)", async () => {
    const f = fakeTx({
      works: [{ id: 1, absorbedIntoId: null }, { id: 2, absorbedIntoId: null }],
      editions: [
        { id: 10, workId: 1, publisher: "Ivrea Argentina", language: "es" }, // sobreviviente
        { id: 20, workId: 2, publisher: "VIZ", language: "en" }, // absorbido (sin colisión)
        { id: 21, workId: 2, publisher: "Ovni Press", language: "es" },
      ],
    });
    const r = await absorbWorkInTx(f.tx, cmd(1, 2));
    expect(r).toMatchObject({ kind: "EXECUTED", survivingWorkId: 1, absorbedWorkId: 2, reparentedEditions: 2 });
    // ediciones del absorbido ahora en el sobreviviente
    expect(f.editions.filter((e) => e.workId === 1)).toHaveLength(3);
    expect(f.editions.filter((e) => e.workId === 2)).toHaveLength(0);
    // el absorbido quedó marcado; el sobreviviente NO se tocó
    expect(f.works.get(2)?.absorbedIntoId).toBe(1);
    expect(f.works.get(1)?.absorbedIntoId).toBeNull();
    // Catálogo NO combina hechos descriptivos: el único update de Work es marcar absorbedIntoId.
    expect(f.workUpdates).toEqual([{ id: 2, data: { absorbedIntoId: 1 } }]);
  });

  it("el port no abre su propia transacción ni toca Identity (el fake no expone $transaction ni catalogIdentity)", async () => {
    // Si el port intentara `$transaction` o `catalogIdentity`, este test lanzaría; que pase lo prueba.
    const f = fakeTx({ works: [{ id: 1, absorbedIntoId: null }, { id: 2, absorbedIntoId: null }] });
    expect((await absorbWorkInTx(f.tx, cmd(1, 2))).kind).toBe("EXECUTED");
  });
});
