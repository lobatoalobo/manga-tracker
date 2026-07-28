import { describe, it, expect } from "vitest";
import { ValidationError } from "@/lib/mutations";
import {
  associateExternalReferenceDecision,
  associateDecisionFingerprint,
  isAssociableState,
  adjudicateAssociateExternalReference,
  ASSOCIATE_INVARIANT,
  type AssociateExternalReferenceDecision,
} from "@/lib/domain/identity/associate";
import { birthIdentity, conferDecision } from "@/lib/domain/identity/confer";
import { associateInTx } from "@/lib/infra/identity/associateRegistro";

// ---------------------------------------------------------------------------
// Dominio — Decisión Asociar + huella + Adjudicación
// ---------------------------------------------------------------------------
describe("dominio — Decisión Asociar", () => {
  const base = { decisionId: "a1", targetHandle: 5, provider: "mangaupdates", externalId: "42" };

  it("valida provider y externalId (reglas consistentes con Conferir)", () => {
    expect(() => associateExternalReferenceDecision({ ...base, provider: "" })).toThrow(ValidationError);
    expect(() => associateExternalReferenceDecision({ ...base, externalId: "  " })).toThrow(ValidationError);
    expect(associateExternalReferenceDecision({ ...base, provider: " mangaupdates ", externalId: " 42 " })).toMatchObject({ provider: "mangaupdates", externalId: "42" });
  });

  it("requiere decisionId, destino y referencia", () => {
    expect(() => associateExternalReferenceDecision({ ...base, decisionId: "" })).toThrow(ValidationError);
    expect(() => associateExternalReferenceDecision({ ...base, targetHandle: 0 })).toThrow(ValidationError);
    expect(() => associateExternalReferenceDecision({ ...base, targetHandle: 1.5 })).toThrow(ValidationError);
  });

  it("la huella cambia si cambia el destino", () => {
    const a = associateExternalReferenceDecision({ ...base, targetHandle: 5 });
    const b = associateExternalReferenceDecision({ ...base, targetHandle: 6 });
    expect(associateDecisionFingerprint(a)).not.toBe(associateDecisionFingerprint(b));
  });

  it("la huella cambia si cambia provider o externalId", () => {
    const a = associateExternalReferenceDecision(base);
    expect(associateDecisionFingerprint(a)).not.toBe(associateDecisionFingerprint(associateExternalReferenceDecision({ ...base, provider: "anilist" })));
    expect(associateDecisionFingerprint(a)).not.toBe(associateDecisionFingerprint(associateExternalReferenceDecision({ ...base, externalId: "43" })));
  });

  it("el mismo input produce la misma huella (e ignora el decisionId)", () => {
    const a = associateExternalReferenceDecision({ ...base, decisionId: "x" });
    const b = associateExternalReferenceDecision({ ...base, decisionId: "y" });
    expect(associateDecisionFingerprint(a)).toBe(associateDecisionFingerprint(b));
  });

  it("Adjudicación solo construye la decisión (propaga invalidez, no la corrige)", () => {
    expect(adjudicateAssociateExternalReference(base)).toEqual({ decisionId: "a1", targetHandle: 5, provider: "mangaupdates", externalId: "42" });
    expect(() => adjudicateAssociateExternalReference({ ...base, decisionId: "" })).toThrow(ValidationError);
  });

  it("Identity no recibe métodos de mutación de referencia ni almacena referencias", () => {
    // El estado local de una Identity no tiene referencias ni método de asociación; solo su estado
    // habilita/deshabilita ser destino (predicado puro).
    const state = birthIdentity(conferDecision({ decisionId: "d", designatedWorkId: 7, contentClass: "MANGA" })) as unknown as Record<string, unknown>;
    expect("externalRefs" in state).toBe(false);
    expect("addExternalReference" in state).toBe(false);
    expect(typeof isAssociableState("ACTIVE")).toBe("boolean");
    expect(isAssociableState("ACTIVE")).toBe(true);
    expect(isAssociableState("RETIRED")).toBe(false);
    expect(isAssociableState("REDIRECTED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registro con dobles controlados
// ---------------------------------------------------------------------------
type Ident = { id: number; state: string };
type Ref = { identityId: number; provider: string; externalId: string; decisionId: string | null; decisionFingerprint: string | null };

function fakeDb(seed: { identities?: Ident[]; refs?: Ref[] } = {}) {
  const identities = new Map((seed.identities ?? []).map((i) => [i.id, i] as const));
  const refs: Ref[] = [...(seed.refs ?? [])];
  const createCalls: Array<Record<string, unknown>> = [];

  const db = {
    catalogIdentity: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const i = identities.get(where.id);
        return i ? { id: i.id, state: i.state } : null;
      },
    },
    identityExternalReference: {
      findUnique: async ({ where }: { where: { decisionId?: string; provider_externalId?: { provider: string; externalId: string } } }) => {
        if (where.decisionId !== undefined) {
          const f = refs.find((r) => r.decisionId === where.decisionId);
          return f ? { decisionFingerprint: f.decisionFingerprint } : null;
        }
        const { provider, externalId } = where.provider_externalId!;
        const f = refs.find((r) => r.provider === provider && r.externalId === externalId);
        return f ? { identityId: f.identityId } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCalls.push(data);
        refs.push({
          identityId: data.identityId as number,
          provider: data.provider as string,
          externalId: data.externalId as string,
          decisionId: (data.decisionId as string) ?? null,
          decisionFingerprint: (data.decisionFingerprint as string) ?? null,
        });
        return { id: refs.length };
      },
    },
  };
  return { db: db as unknown as Parameters<typeof associateInTx>[0], createCalls };
}

const decision = (over: Partial<AssociateExternalReferenceDecision> = {}): AssociateExternalReferenceDecision =>
  associateExternalReferenceDecision({ decisionId: "a1", targetHandle: 5, provider: "mangaupdates", externalId: "42", ...over });

const boundRef = (d: AssociateExternalReferenceDecision, identityId = d.targetHandle): Ref => ({
  identityId,
  provider: d.provider,
  externalId: d.externalId,
  decisionId: d.decisionId,
  decisionFingerprint: associateDecisionFingerprint(d),
});

describe("Registro — Asociar (dobles)", () => {
  it("referencia libre + destino ACTIVE válido → EXECUTED", async () => {
    const { db } = fakeDb({ identities: [{ id: 5, state: "ACTIVE" }] });
    const r = await associateInTx(db, decision());
    expect(r.kind).toBe("EXECUTED");
    if (r.kind === "EXECUTED") expect(r.reference).toEqual({ handle: 5, provider: "mangaupdates", externalId: "42" });
  });

  it("replay exacto de la misma decisión → ALREADY_SATISFIED", async () => {
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "ACTIVE" }], refs: [boundRef(decision())] });
    const r = await associateInTx(db, decision());
    expect(r.kind).toBe("ALREADY_SATISFIED");
    expect(createCalls).toHaveLength(0);
  });

  it("reuso divergente del decisionId → REJECTED", async () => {
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "ACTIVE" }], refs: [boundRef(decision({ externalId: "42" }))] });
    const r = await associateInTx(db, decision({ externalId: "999" })); // mismo decisionId a1, otra referencia
    expect(r).toMatchObject({ kind: "REJECTED", invariant: ASSOCIATE_INVARIANT.DECISION_ID_REUSED_DIVERGENTLY });
    expect(createCalls).toHaveLength(0);
  });

  it("misma referencia ya ligada al MISMO destino por OTRA decisión → ALREADY_ASSOCIATED", async () => {
    const prev = decision({ decisionId: "prev" });
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "ACTIVE" }], refs: [boundRef(prev, 5)] });
    const r = await associateInTx(db, decision({ decisionId: "a2" })); // otra decisión, mismo (ref, destino)
    expect(r.kind).toBe("ALREADY_ASSOCIATED");
    expect(createCalls).toHaveLength(0);
  });

  it("misma referencia ligada a OTRO destino → REFERENCE_ALREADY_BOUND", async () => {
    const other = decision({ decisionId: "prev" });
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "ACTIVE" }, { id: 9, state: "ACTIVE" }], refs: [boundRef(other, 9)] });
    const r = await associateInTx(db, decision({ decisionId: "a2", targetHandle: 5 }));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: ASSOCIATE_INVARIANT.REFERENCE_ALREADY_BOUND });
    expect(createCalls).toHaveLength(0);
  });

  it("handle destino inexistente → IDENTITY_NOT_FOUND (resultado, no excepción)", async () => {
    const { db, createCalls } = fakeDb({ identities: [] });
    const r = await associateInTx(db, decision());
    expect(r).toMatchObject({ kind: "REJECTED", invariant: ASSOCIATE_INVARIANT.IDENTITY_NOT_FOUND });
    expect(createCalls).toHaveLength(0);
  });

  it("destino existe pero no ACTIVE → INVALID_IDENTITY_STATE", async () => {
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "RETIRED" }] });
    const r = await associateInTx(db, decision());
    expect(r).toMatchObject({ kind: "REJECTED", invariant: ASSOCIATE_INVARIANT.INVALID_IDENTITY_STATE });
    expect(createCalls).toHaveLength(0);
  });

  it("cualquier rechazo previo → ninguna escritura parcial", async () => {
    // destino inválido y referencia libre: aún así no se intenta el create.
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "REDIRECTED" }] });
    await associateInTx(db, decision());
    expect(createCalls).toHaveLength(0);
  });

  it("el Registro NO substituye el destino ni modifica la referencia: persiste verbatim", async () => {
    const { db, createCalls } = fakeDb({ identities: [{ id: 5, state: "ACTIVE" }] });
    await associateInTx(db, decision({ decisionId: "a9", provider: "anilist", externalId: "777" }));
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({ identityId: 5, provider: "anilist", externalId: "777", decisionId: "a9" });
  });
});
