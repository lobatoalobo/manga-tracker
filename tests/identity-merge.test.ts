import { describe, it, expect } from "vitest";
import { ValidationError } from "@/lib/mutations";
import {
  mergeDecision,
  mergeDecisionFingerprint,
  adjudicateMergeIdentities,
  isSurvivorState,
  isAbsorbableState,
  MERGE_REASON,
  type MergeDecision,
} from "@/lib/domain/identity/merge";
import { MERGE_PLAN_V1 } from "@/lib/domain/catalog/absorbWork";
import {
  prepareIdentityMergeInTx,
  applyIdentityMergeInTx,
  isMergeDecisionIdConflict,
  MERGE_DECISION_ID_CONSTRAINT,
  type PreparedMerge,
} from "@/lib/infra/identity/mergeRegistro";
import { makeMergeIdentities } from "@/lib/identity/mergeIdentities";
import { Prisma } from "@prisma/client";

// ===========================================================================
// Dominio — Decisión Fusionar + huella + Adjudicación
// ===========================================================================
describe("dominio — Decisión Fusionar", () => {
  const base = { decisionId: "m1", survivingHandle: 10, absorbedHandle: 20 };

  it("construye una decisión válida (normaliza el decisionId, plan v1 por default)", () => {
    const d = mergeDecision({ ...base, decisionId: "  m1  " });
    expect(d).toEqual({ decisionId: "m1", survivingHandle: 10, absorbedHandle: 20, catalogMergePlan: MERGE_PLAN_V1 });
  });

  it("una decisión inválida no puede construirse (ValidationError)", () => {
    expect(() => mergeDecision({ ...base, decisionId: "" })).toThrow(ValidationError);
    expect(() => mergeDecision({ ...base, survivingHandle: 0 })).toThrow(ValidationError);
    expect(() => mergeDecision({ ...base, absorbedHandle: 1.5 })).toThrow(ValidationError);
  });

  it("rechaza handles iguales (self-merge = decisión malformada)", () => {
    expect(() => mergeDecision({ ...base, survivingHandle: 7, absorbedHandle: 7 })).toThrow(ValidationError);
  });

  it("rechaza un MergePlan de versión no soportada", () => {
    expect(() => mergeDecision({ ...base, catalogMergePlan: { version: 2 } as unknown as typeof MERGE_PLAN_V1 })).toThrow(ValidationError);
  });

  it("predicados de estado: solo ACTIVE sin redirect habilita sobreviviente/absorbida", () => {
    expect(isSurvivorState("ACTIVE", null)).toBe(true);
    expect(isSurvivorState("ACTIVE", 3)).toBe(false);
    expect(isSurvivorState("REDIRECTED", 3)).toBe(false);
    expect(isAbsorbableState("ACTIVE", null)).toBe(true);
    expect(isAbsorbableState("REDIRECTED", 9)).toBe(false);
  });
});

describe("dominio — huella semántica (mergeDecisionFingerprint)", () => {
  const mk = (over: Partial<MergeDecision> = {}) => mergeDecision({ decisionId: "x", survivingHandle: 10, absorbedHandle: 20, ...over });

  it("ignora el decisionId (identidad, no intención)", () => {
    const a = mergeDecision({ decisionId: "x", survivingHandle: 10, absorbedHandle: 20 });
    const b = mergeDecision({ decisionId: "y", survivingHandle: 10, absorbedHandle: 20 });
    expect(mergeDecisionFingerprint(a)).toBe(mergeDecisionFingerprint(b));
  });

  it("la DIRECCIÓN importa: (survivor A, absorbed B) ≠ (survivor B, absorbed A)", () => {
    const ab = mergeDecision({ decisionId: "x", survivingHandle: 10, absorbedHandle: 20 });
    const ba = mergeDecision({ decisionId: "x", survivingHandle: 20, absorbedHandle: 10 });
    expect(mergeDecisionFingerprint(ab)).not.toBe(mergeDecisionFingerprint(ba));
  });

  it("incluye el plan de contenido", () => {
    expect(mergeDecisionFingerprint(mk()).includes("catalogPlan")).toBe(true);
  });

  it("excluye ids técnicos, timestamps, estados y cantidades derivadas de ejecución", () => {
    const fp = mergeDecisionFingerprint(mk());
    for (const forbidden of ["redirectsToId", "createdAt", "state", "movedReferences", "reparentedEditions", "REDIRECTED"]) {
      expect(fp.includes(forbidden)).toBe(false);
    }
  });
});

describe("dominio — Adjudicación Fusionar", () => {
  it("emite una Decisión válida y propaga la invalidez (no la corrige)", () => {
    expect(adjudicateMergeIdentities({ decisionId: "m1", survivingHandle: 10, absorbedHandle: 20 })).toMatchObject({ survivingHandle: 10, absorbedHandle: 20 });
    expect(() => adjudicateMergeIdentities({ decisionId: "", survivingHandle: 10, absorbedHandle: 20 })).toThrow(ValidationError);
    expect(() => adjudicateMergeIdentities({ decisionId: "m1", survivingHandle: 5, absorbedHandle: 5 })).toThrow(ValidationError);
  });
});

// ===========================================================================
// Fake tx en memoria (namespace + Catálogo) — el write-port real corre contra él
// ===========================================================================
type IdentRow = {
  id: number;
  state: string;
  redirectsToId: number | null;
  contentClass: string;
  designatedWorkId: number;
  mergeDecisionId: string | null;
  mergeDecisionFingerprint: string | null;
};
type RefRow = { identityId: number; provider: string; externalId: string };
type WorkRow = { id: number; absorbedIntoId: number | null };
type EditionRow = { workId: number; publisher: string; language: string };

function fakeWorld(seed: { identities?: Partial<IdentRow>[]; refs?: RefRow[]; works?: WorkRow[]; editions?: EditionRow[] } = {}) {
  const identities = new Map<number, IdentRow>();
  for (const i of seed.identities ?? []) {
    identities.set(i.id!, {
      id: i.id!,
      state: i.state ?? "ACTIVE",
      redirectsToId: i.redirectsToId ?? null,
      contentClass: i.contentClass ?? "MANGA",
      designatedWorkId: i.designatedWorkId ?? i.id!,
      mergeDecisionId: i.mergeDecisionId ?? null,
      mergeDecisionFingerprint: i.mergeDecisionFingerprint ?? null,
    });
  }
  const refs: RefRow[] = [...(seed.refs ?? [])];
  const works = new Map<number, WorkRow>((seed.works ?? []).map((w) => [w.id, { ...w }]));
  const editions: EditionRow[] = (seed.editions ?? []).map((e) => ({ ...e }));
  const calls: string[] = [];

  const tx = {
    $queryRaw: async () => {
      calls.push("lock");
      return [];
    },
    catalogIdentity: {
      findUnique: async ({ where }: { where: { id?: number; mergeDecisionId?: string } }) => {
        if (where.mergeDecisionId !== undefined) {
          const f = [...identities.values()].find((i) => i.mergeDecisionId === where.mergeDecisionId);
          return f ? { ...f } : null;
        }
        const i = identities.get(where.id!);
        return i ? { ...i } : null;
      },
      findFirst: async ({ where }: { where: { redirectsToId: number } }) => {
        const f = [...identities.values()].find((i) => i.redirectsToId === where.redirectsToId);
        return f ? { id: f.id } : null;
      },
      update: async ({ where, data }: { where: { id: number }; data: Partial<IdentRow> }) => {
        calls.push("flip");
        const i = identities.get(where.id)!;
        Object.assign(i, data);
        return { id: i.id };
      },
    },
    identityExternalReference: {
      updateMany: async ({ where, data }: { where: { identityId: number }; data: { identityId: number } }) => {
        calls.push("move");
        let count = 0;
        for (const r of refs) if (r.identityId === where.identityId) { r.identityId = data.identityId; count++; }
        return { count };
      },
    },
    work: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const w = works.get(where.id);
        return w ? { id: w.id, absorbedIntoId: w.absorbedIntoId } : null;
      },
      findFirst: async ({ where }: { where: { absorbedIntoId: number } }) => {
        const w = [...works.values()].find((x) => x.absorbedIntoId === where.absorbedIntoId);
        return w ? { id: w.id } : null;
      },
      update: async ({ where, data }: { where: { id: number }; data: { absorbedIntoId: number } }) => {
        works.get(where.id)!.absorbedIntoId = data.absorbedIntoId;
        return { id: where.id };
      },
    },
    publisherEdition: {
      findMany: async ({ where }: { where: { workId: number } }) => editions.filter((e) => e.workId === where.workId).map((e) => ({ publisher: e.publisher, language: e.language })),
      updateMany: async ({ where, data }: { where: { workId: number }; data: { workId: number } }) => {
        let count = 0;
        for (const e of editions) if (e.workId === where.workId) { e.workId = data.workId; count++; }
        return { count };
      },
    },
  };
  const client = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    catalogIdentity: tx.catalogIdentity,
  };
  return { tx, client, identities, refs, works, editions, calls };
}

const decision = (over: Partial<MergeDecision> = {}): MergeDecision =>
  mergeDecision({ decisionId: "m1", survivingHandle: 10, absorbedHandle: 20, ...over });

// ===========================================================================
// Registro (fase 1: prepare) con dobles
// ===========================================================================
describe("Registro — prepareIdentityMergeInTx (dobles)", () => {
  const both = (over: { s?: Partial<IdentRow>; a?: Partial<IdentRow> } = {}) => ({
    identities: [
      { id: 10, designatedWorkId: 100, ...over.s },
      { id: 20, designatedWorkId: 200, ...over.a },
    ],
  });

  it("todo válido → READY con los Work ids de cada identidad", async () => {
    const { tx } = fakeWorld(both());
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toEqual({ kind: "READY", survivingHandle: 10, absorbedHandle: 20, survivingWorkId: 100, absorbedWorkId: 200 });
  });

  it("sobreviviente inexistente → IDENTITY_NOT_FOUND (survivor)", async () => {
    const { tx } = fakeWorld({ identities: [{ id: 20, designatedWorkId: 200 }] });
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.IDENTITY_NOT_FOUND, missing: "survivor" });
  });

  it("absorbida inexistente → IDENTITY_NOT_FOUND (absorbed)", async () => {
    const { tx } = fakeWorld({ identities: [{ id: 10, designatedWorkId: 100 }] });
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.IDENTITY_NOT_FOUND, missing: "absorbed" });
  });

  it("sobreviviente no ACTIVE (ya redirigida) → INVALID_SURVIVOR_STATE", async () => {
    const { tx } = fakeWorld(both({ s: { state: "REDIRECTED", redirectsToId: 30 } }));
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.INVALID_SURVIVOR_STATE });
  });

  it("absorbida ya redirige a OTRA → INVALID_ABSORBED_STATE (contradicción, no idempotencia)", async () => {
    const { tx } = fakeWorld(both({ a: { state: "REDIRECTED", redirectsToId: 99 } }));
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.INVALID_ABSORBED_STATE });
  });

  it("clases de contenido incompatibles → CONTENT_CLASS_INCOMPATIBLE", async () => {
    const { tx } = fakeWorld(both({ a: { contentClass: "COMIC" } }));
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.CONTENT_CLASS_INCOMPATIBLE });
  });

  it("absorbida con redirecciones ENTRANTES → REDIRECT_DEPENDENTS_PRESENT (v1 no encadena)", async () => {
    const { tx } = fakeWorld({
      identities: [
        { id: 10, designatedWorkId: 100 },
        { id: 20, designatedWorkId: 200 },
        { id: 30, state: "REDIRECTED", redirectsToId: 20, designatedWorkId: 300 }, // 30 → 20
      ],
    });
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.REDIRECT_DEPENDENTS_PRESENT });
  });

  it("replay de la MISMA decisión (huella coincide) → ALREADY_SATISFIED", async () => {
    const d = decision();
    const fp = mergeDecisionFingerprint(d);
    const { tx } = fakeWorld({
      identities: [
        { id: 10, designatedWorkId: 100 },
        { id: 20, state: "REDIRECTED", redirectsToId: 10, designatedWorkId: 200, mergeDecisionId: "m1", mergeDecisionFingerprint: fp },
      ],
    });
    const r = await prepareIdentityMergeInTx(tx as never, d);
    expect(r).toMatchObject({ kind: "ALREADY_SATISFIED" });
  });

  it("mismo decisionId con huella distinta → DECISION_ID_REUSED_DIVERGENTLY", async () => {
    const { tx } = fakeWorld({
      identities: [
        { id: 10, designatedWorkId: 100 },
        { id: 20, state: "REDIRECTED", redirectsToId: 10, designatedWorkId: 200, mergeDecisionId: "m1", mergeDecisionFingerprint: "otra-huella" },
      ],
    });
    const r = await prepareIdentityMergeInTx(tx as never, decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.DECISION_ID_REUSED_DIVERGENTLY });
  });

  it("absorbida ya redirige a la MISMA sobreviviente por OTRA decisión → ALREADY_MERGED (≠ replay)", async () => {
    const { tx } = fakeWorld({
      identities: [
        { id: 10, designatedWorkId: 100 },
        { id: 20, state: "REDIRECTED", redirectsToId: 10, designatedWorkId: 200, mergeDecisionId: "otra", mergeDecisionFingerprint: "fp-otra" },
      ],
    });
    const r = await prepareIdentityMergeInTx(tx as never, decision()); // decisionId m1, distinto de "otra"
    expect(r).toMatchObject({ kind: "ALREADY_MERGED" });
  });

  it("handles iguales en una decisión construida a mano → SAME_IDENTITY (red de seguridad del Registro)", async () => {
    const { tx } = fakeWorld({ identities: [{ id: 10, designatedWorkId: 100 }] });
    const handmade = { decisionId: "m1", survivingHandle: 10, absorbedHandle: 10, catalogMergePlan: MERGE_PLAN_V1 } as MergeDecision;
    const r = await prepareIdentityMergeInTx(tx as never, handmade);
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.SAME_IDENTITY });
  });

  it("prepare NO escribe (solo lee y lockea): ni flip ni move", async () => {
    const { tx, calls } = fakeWorld(both({ a: { state: "REDIRECTED", redirectsToId: 99 } }));
    await prepareIdentityMergeInTx(tx as never, decision());
    expect(calls).not.toContain("flip");
    expect(calls).not.toContain("move");
  });
});

// ===========================================================================
// Registro (fase 2: apply) con dobles — orden de mutación
// ===========================================================================
describe("Registro — applyIdentityMergeInTx (dobles)", () => {
  const prepared: PreparedMerge = { kind: "READY", survivingHandle: 10, absorbedHandle: 20, survivingWorkId: 100, absorbedWorkId: 200 };

  it("mueve referencias ANTES de flipear el estado (orden ADR-009)", async () => {
    const { tx, calls } = fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100 }, { id: 20, designatedWorkId: 200 }],
      refs: [{ identityId: 20, provider: "anilist", externalId: "1" }, { identityId: 20, provider: "mangaupdates", externalId: "2" }],
    });
    const r = await applyIdentityMergeInTx(tx as never, decision(), prepared);
    expect(r.movedReferences).toBe(2);
    expect(calls.indexOf("move")).toBeLessThan(calls.indexOf("flip")); // mover < flipear
  });

  it("flipea la absorbida a REDIRECTED con redirección + procedencia; mueve las referencias a la sobreviviente", async () => {
    const { tx, identities, refs } = fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100 }, { id: 20, designatedWorkId: 200 }],
      refs: [{ identityId: 20, provider: "anilist", externalId: "1" }],
    });
    await applyIdentityMergeInTx(tx as never, decision(), prepared);
    const abs = identities.get(20)!;
    expect(abs.state).toBe("REDIRECTED");
    expect(abs.redirectsToId).toBe(10);
    expect(abs.mergeDecisionId).toBe("m1");
    expect(abs.mergeDecisionFingerprint).toBe(mergeDecisionFingerprint(decision()));
    expect(refs.every((r) => r.identityId === 10)).toBe(true); // todas movidas a la sobreviviente
  });
});

// ===========================================================================
// Coordinador (dobles) — composición Catálogo + Registro en una tx
// ===========================================================================
describe("coordinador — makeMergeIdentities (dobles)", () => {
  const world = () =>
    fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100 }, { id: 20, designatedWorkId: 200 }],
      refs: [{ identityId: 20, provider: "anilist", externalId: "1" }],
      works: [{ id: 100, absorbedIntoId: null }, { id: 200, absorbedIntoId: null }],
      editions: [{ workId: 100, publisher: "Ivrea", language: "es" }, { workId: 200, publisher: "VIZ", language: "en" }],
    });

  it("EXECUTED: absorbe contenido y muta el namespace en una sola pasada (Catálogo + Registro)", async () => {
    const { client, identities, works, refs, editions } = world();
    const r = await makeMergeIdentities(client as never).merge(decision());
    expect(r).toMatchObject({ kind: "EXECUTED", survivingHandle: 10, absorbedHandle: 20, survivingWorkId: 100, absorbedWorkId: 200, reparentedEditions: 1, movedReferences: 1 });
    // efectos combinados
    expect(works.get(200)!.absorbedIntoId).toBe(100); // Work absorbido marcado
    expect(editions.filter((e) => e.workId === 100)).toHaveLength(2); // edición re-parentada
    expect(identities.get(20)!.state).toBe("REDIRECTED"); // identidad redirigida
    expect(identities.get(20)!.redirectsToId).toBe(10);
    expect(refs.every((r) => r.identityId === 10)).toBe(true); // referencias movidas
  });

  it("conflicto de contenido de Catálogo → CONTENT_CONFLICT_REQUIRES_JUDGMENT y el namespace NO se muta", async () => {
    const { client, identities, works } = fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100 }, { id: 20, designatedWorkId: 200 }],
      works: [{ id: 100, absorbedIntoId: null }, { id: 200, absorbedIntoId: null }],
      editions: [{ workId: 100, publisher: "Ivrea", language: "es" }, { workId: 200, publisher: "Ivrea", language: "es" }], // slot compartido
    });
    const r = await makeMergeIdentities(client as never).merge(decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.CONTENT_CONFLICT_REQUIRES_JUDGMENT });
    if (r.kind === "REJECTED") expect(r.conflicts).toEqual([{ publisher: "Ivrea", language: "es" }]);
    expect(identities.get(20)!.state).toBe("ACTIVE"); // namespace intacto
    expect(works.get(200)!.absorbedIntoId).toBeNull(); // Catálogo no escribió
  });

  it("rechazo temprano del Registro (clase incompatible) → no toca Catálogo ni namespace", async () => {
    const { client, identities, works } = fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100, contentClass: "MANGA" }, { id: 20, designatedWorkId: 200, contentClass: "COMIC" }],
      works: [{ id: 100, absorbedIntoId: null }, { id: 200, absorbedIntoId: null }],
    });
    const r = await makeMergeIdentities(client as never).merge(decision());
    expect(r).toMatchObject({ kind: "REJECTED", reason: MERGE_REASON.CONTENT_CLASS_INCOMPATIBLE });
    expect(works.get(200)!.absorbedIntoId).toBeNull();
    expect(identities.get(20)!.state).toBe("ACTIVE");
  });

  it("ALREADY_MERGED (otra decisión) se distingue de ALREADY_SATISFIED (replay)", async () => {
    const d = decision();
    const fp = mergeDecisionFingerprint(d);
    const replayWorld = fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100 }, { id: 20, state: "REDIRECTED", redirectsToId: 10, designatedWorkId: 200, mergeDecisionId: "m1", mergeDecisionFingerprint: fp }],
    });
    const mergedWorld = fakeWorld({
      identities: [{ id: 10, designatedWorkId: 100 }, { id: 20, state: "REDIRECTED", redirectsToId: 10, designatedWorkId: 200, mergeDecisionId: "otra", mergeDecisionFingerprint: "fp-otra" }],
    });
    expect((await makeMergeIdentities(replayWorld.client as never).merge(d)).kind).toBe("ALREADY_SATISFIED");
    expect((await makeMergeIdentities(mergedWorld.client as never).merge(d)).kind).toBe("ALREADY_MERGED");
  });

  it("el coordinador NO substituye handles por terminales: usa los de la Decisión verbatim", async () => {
    const { client, identities } = world();
    await makeMergeIdentities(client as never).merge(decision());
    // 20 quedó redirigido a 10 exactamente (no a un terminal resuelto de otra cosa)
    expect(identities.get(20)!.redirectsToId).toBe(10);
  });
});

// ===========================================================================
// Traducción de conflicto Prisma (P2002 mergeDecisionId)
// ===========================================================================
describe("infra — isMergeDecisionIdConflict", () => {
  const p2002 = (target: unknown) => new Prisma.PrismaClientKnownRequestError("u", { code: "P2002", clientVersion: "6.19.3", meta: { target } });
  it("reconoce el P2002 de mergeDecisionId (array de campos y nombre de índice)", () => {
    expect(isMergeDecisionIdConflict(p2002(["mergeDecisionId"]))).toBe(true);
    expect(isMergeDecisionIdConflict(p2002(MERGE_DECISION_ID_CONSTRAINT))).toBe(true);
  });
  it("no reconoce otros conflictos ni otros códigos", () => {
    expect(isMergeDecisionIdConflict(p2002(["decisionId"]))).toBe(false);
    expect(isMergeDecisionIdConflict(new Prisma.PrismaClientKnownRequestError("u", { code: "P2003", clientVersion: "6.19.3", meta: {} }))).toBe(false);
    expect(isMergeDecisionIdConflict(new Error("nope"))).toBe(false);
  });
});
