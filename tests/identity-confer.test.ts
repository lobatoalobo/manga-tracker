import { describe, it, expect } from "vitest";
import { ValidationError } from "@/lib/mutations";
import {
  conferDecision,
  conferDecisionFingerprint,
  birthIdentity,
  IDENTITY_STATE_ACTIVE,
  CONFER_INVARIANT,
  type ConferDecision,
} from "@/lib/domain/identity/confer";
import { adjudicateConferNew } from "@/lib/domain/identity/adjudication";
import { conferInTx, classifyConferConflict } from "@/lib/infra/identity/registro";

// ---------------------------------------------------------------------------
// Dominio — construcción de la Decisión + nacimiento LOCAL de la Identity
// ---------------------------------------------------------------------------
describe("dominio — Decisión Conferir", () => {
  const base = { decisionId: "d1", designatedWorkId: 7, contentClass: "MANGA" };

  it("construye una decisión válida (normaliza trims)", () => {
    const d = conferDecision({ decisionId: "  d1  ", designatedWorkId: 7, contentClass: " MANGA " });
    expect(d).toEqual({ decisionId: "d1", designatedWorkId: 7, contentClass: "MANGA", seedReferences: [] });
  });

  it("una decisión incompleta o inválida no puede construirse (ValidationError)", () => {
    expect(() => conferDecision({ ...base, decisionId: "" })).toThrow(ValidationError);
    expect(() => conferDecision({ ...base, decisionId: "   " })).toThrow(ValidationError);
    expect(() => conferDecision({ ...base, designatedWorkId: 0 })).toThrow(ValidationError);
    expect(() => conferDecision({ ...base, designatedWorkId: 1.5 })).toThrow(ValidationError);
    expect(() => conferDecision({ ...base, contentClass: "NOPE" })).toThrow(ValidationError);
    expect(() => conferDecision({ ...base, seedReferences: [{ provider: "mangaupdates", externalId: "" }] })).toThrow(ValidationError);
    expect(() => conferDecision({ ...base, seedReferences: [{ provider: "", externalId: "x" }] })).toThrow(ValidationError);
  });

  it("rechaza referencias semilla duplicadas dentro de la misma decisión", () => {
    expect(() =>
      conferDecision({
        ...base,
        seedReferences: [
          { provider: "mangaupdates", externalId: "42" },
          { provider: "mangaupdates", externalId: "42" },
        ],
      }),
    ).toThrow(ValidationError);
    // dos referencias distintas del mismo provider SÍ son válidas
    expect(() =>
      conferDecision({
        ...base,
        seedReferences: [
          { provider: "mangaupdates", externalId: "42" },
          { provider: "mangaupdates", externalId: "43" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("dominio — nacimiento de la Identity (invariantes locales)", () => {
  const d = conferDecision({ decisionId: "d1", designatedWorkId: 7, contentClass: "MANGA" });

  it("una Identity nueva solo puede nacer activa", () => {
    expect(birthIdentity(d).state).toBe(IDENTITY_STATE_ACTIVE);
  });
  it("nace designando exactamente un contenido", () => {
    expect(birthIdentity(d).designatedWorkId).toBe(7);
  });
  it("no nace con destino de redirección", () => {
    expect(birthIdentity(d).redirectsTo).toBeNull();
  });
  it("no nace retirada", () => {
    expect(birthIdentity(d).retired).toBe(false);
  });
  it("la clase de contenido queda fijada por la decisión", () => {
    expect(birthIdentity(d).contentClass).toBe("MANGA");
  });
  it("Identity NO contiene estado local de referencias externas", () => {
    const state = birthIdentity(d) as unknown as Record<string, unknown>;
    expect("references" in state).toBe(false);
    expect("externalRefs" in state).toBe(false);
    expect("seedReferences" in state).toBe(false);
  });
});

describe("dominio — Adjudicación (costura de juicio)", () => {
  it("emite una Decisión Conferir válida a partir del juicio 'nuevo'", () => {
    const d = adjudicateConferNew({ decisionId: "d1", designatedWorkId: 7, contentClass: "COMIC" });
    expect(d).toEqual({ decisionId: "d1", designatedWorkId: 7, contentClass: "COMIC", seedReferences: [] });
  });
  it("propaga la invalidez de la decisión (no la corrige)", () => {
    expect(() => adjudicateConferNew({ decisionId: "", designatedWorkId: 7, contentClass: "MANGA" })).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Registro con dobles controlados — camino amable (los invariantes globales bajo
// concurrencia se prueban en la suite de integración con base real)
// ---------------------------------------------------------------------------
type Ident = { id: number; state: string; designatedWorkId: number; decisionId: string; contentClass: string; decisionFingerprint: string };
type Ref = { provider: string; externalId: string };

function fakeDb(seed: { works?: { id: number; type: string }[]; identities?: Ident[]; refs?: Ref[] } = {}) {
  const works = new Map((seed.works ?? []).map((w) => [w.id, w] as const));
  const identities: Ident[] = [...(seed.identities ?? [])];
  const refs: Ref[] = [...(seed.refs ?? [])];
  let nextId = Math.max(0, ...identities.map((i) => i.id)) + 1;
  const createCalls: Array<Record<string, unknown>> = [];

  const db = {
    work: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const w = works.get(where.id);
        return w ? { id: w.id, type: w.type } : null;
      },
    },
    catalogIdentity: {
      findUnique: async ({ where }: { where: { decisionId: string } }) => {
        const f = identities.find((i) => i.decisionId === where.decisionId);
        return f ? { id: f.id, contentClass: f.contentClass, designatedWorkId: f.designatedWorkId, decisionFingerprint: f.decisionFingerprint } : null;
      },
      findFirst: async ({ where }: { where: { designatedWorkId: number; state: string } }) => {
        const f = identities.find((i) => i.designatedWorkId === where.designatedWorkId && i.state === where.state);
        return f ? { id: f.id } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCalls.push(data);
        const id = nextId++;
        identities.push({
          id,
          state: data.state as string,
          contentClass: data.contentClass as string,
          designatedWorkId: data.designatedWorkId as number,
          decisionId: data.decisionId as string,
          decisionFingerprint: data.decisionFingerprint as string,
        });
        const nested = data.externalRefs as { create?: Ref[] } | undefined;
        for (const r of nested?.create ?? []) refs.push(r);
        return { id, contentClass: data.contentClass as string, designatedWorkId: data.designatedWorkId as number };
      },
    },
    identityExternalReference: {
      findUnique: async ({ where }: { where: { provider_externalId: Ref } }) => {
        const { provider, externalId } = where.provider_externalId;
        const f = refs.find((r) => r.provider === provider && r.externalId === externalId);
        return f ? { id: 1 } : null;
      },
    },
  };
  return { db: db as unknown as Parameters<typeof conferInTx>[0], createCalls };
}

/** Identidad ya conferida por una decisión dada (para sembrar el fake con huella coherente). */
const conferred = (id: number, d: ConferDecision): Ident => ({
  id,
  state: "ACTIVE",
  designatedWorkId: d.designatedWorkId,
  decisionId: d.decisionId,
  contentClass: d.contentClass,
  decisionFingerprint: conferDecisionFingerprint(d),
});

const decision = (over: Partial<ConferDecision> = {}): ConferDecision =>
  conferDecision({ decisionId: "d1", designatedWorkId: 7, contentClass: "MANGA", ...over });

describe("Registro — Conferir (dobles)", () => {
  it("contenido no designado + referencias libres → EXECUTED", async () => {
    const { db } = fakeDb({ works: [{ id: 7, type: "MANGA" }] });
    const r = await conferInTx(db, decision({ seedReferences: [{ provider: "mangaupdates", externalId: "42" }] }));
    expect(r.kind).toBe("EXECUTED");
    if (r.kind === "EXECUTED") {
      expect(r.identity.handle).toBeGreaterThan(0);
      expect(r.identity.state).toBe(IDENTITY_STATE_ACTIVE);
      expect(r.identity.designatedWorkId).toBe(7);
      expect(r.identity.contentClass).toBe("MANGA");
    }
  });

  it("contenido ya designado por una identidad activa → REJECTED (designación única)", async () => {
    const { db, createCalls } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      identities: [conferred(1, decision({ decisionId: "other" }))],
    });
    const r = await conferInTx(db, decision());
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.DESIGNATION_TAKEN });
    expect(createCalls).toHaveLength(0); // sin persistencia parcial
  });

  it("una referencia semilla ya ligada a otra identidad → REJECTED (unicidad de referencia)", async () => {
    const { db, createCalls } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      refs: [{ provider: "mangaupdates", externalId: "42" }],
    });
    const r = await conferInTx(db, decision({ seedReferences: [{ provider: "mangaupdates", externalId: "42" }] }));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.REFERENCE_ALREADY_BOUND });
    expect(createCalls).toHaveLength(0);
  });

  it("repetición de la MISMA decisión ya ejecutada → ALREADY_SATISFIED (eco)", async () => {
    const { db, createCalls } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      identities: [conferred(5, decision())], // misma huella semántica
    });
    const r = await conferInTx(db, decision()); // mismo decisionId "d1" + misma intención
    expect(r.kind).toBe("ALREADY_SATISFIED");
    if (r.kind === "ALREADY_SATISFIED") expect(r.identity.handle).toBe(5);
    expect(createCalls).toHaveLength(0); // idempotente: no reinserta
  });

  it("MISMO contenido con OTRA decisión → REJECTED, no idempotente", async () => {
    const { db } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      identities: [conferred(5, decision({ decisionId: "prev" }))],
    });
    const r = await conferInTx(db, decision({ decisionId: "d2" }));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.DESIGNATION_TAKEN });
  });

  // Idempotencia SEMÁNTICA: mismo decisionId con intención divergente → rechazo explícito.
  it("mismo decisionId, CONTENIDO diferente → REJECTED (reuso divergente)", async () => {
    const { db, createCalls } = fakeDb({
      works: [{ id: 7, type: "MANGA" }, { id: 8, type: "MANGA" }],
      identities: [conferred(5, decision({ designatedWorkId: 7 }))], // d1 → work 7
    });
    const r = await conferInTx(db, decision({ designatedWorkId: 8 })); // d1 → work 8
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.DECISION_ID_REUSED_DIVERGENTLY });
    expect(createCalls).toHaveLength(0);
  });

  it("mismo decisionId, CLASE diferente → REJECTED (reuso divergente)", async () => {
    const { db } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      identities: [conferred(5, decision({ contentClass: "MANGA" }))],
    });
    const r = await conferInTx(db, decision({ contentClass: "COMIC" })); // mismo d1/work, otra clase
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.DECISION_ID_REUSED_DIVERGENTLY });
  });

  it("mismo decisionId, REFERENCIAS diferentes → REJECTED (reuso divergente)", async () => {
    const { db } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      identities: [conferred(5, decision({ seedReferences: [{ provider: "anilist", externalId: "1" }] }))],
    });
    const r = await conferInTx(db, decision({ seedReferences: [{ provider: "anilist", externalId: "2" }] }));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.DECISION_ID_REUSED_DIVERGENTLY });
  });

  it("mismo decisionId, mismas referencias en DISTINTO ORDEN → ALREADY_SATISFIED (idempotente)", async () => {
    const refsA = [{ provider: "anilist", externalId: "1" }, { provider: "mangaupdates", externalId: "2" }];
    const refsB = [{ provider: "mangaupdates", externalId: "2" }, { provider: "anilist", externalId: "1" }];
    const { db, createCalls } = fakeDb({
      works: [{ id: 7, type: "MANGA" }],
      identities: [conferred(5, decision({ seedReferences: refsA }))],
    });
    const r = await conferInTx(db, decision({ seedReferences: refsB }));
    expect(r.kind).toBe("ALREADY_SATISFIED");
    expect(createCalls).toHaveLength(0);
  });

  it("contenido designado inexistente → REJECTED (contenido no encontrado)", async () => {
    const { db, createCalls } = fakeDb({ works: [] });
    const r = await conferInTx(db, decision());
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.DESIGNATED_CONTENT_NOT_FOUND });
    expect(createCalls).toHaveLength(0);
  });

  it("clase incompatible con el contenido designado → REJECTED", async () => {
    const { db, createCalls } = fakeDb({ works: [{ id: 7, type: "COMIC" }] });
    const r = await conferInTx(db, decision({ contentClass: "MANGA" }));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: CONFER_INVARIANT.CONTENT_CLASS_INCOMPATIBLE });
    expect(createCalls).toHaveLength(0);
  });

  it("el Registro NO elige ni modifica datos: persiste la decisión verbatim", async () => {
    const { db, createCalls } = fakeDb({ works: [{ id: 7, type: "MANGA" }] });
    await conferInTx(db, decision({ decisionId: "d9", seedReferences: [{ provider: "anilist", externalId: "999" }] }));
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      state: IDENTITY_STATE_ACTIVE,
      contentClass: "MANGA",
      designatedWorkId: 7,
      decisionId: "d9",
      externalRefs: { create: [{ provider: "anilist", externalId: "999" }] },
    });
  });
});

// ---------------------------------------------------------------------------
// Huella semántica de la Decisión (identidad semántica canónica)
// ---------------------------------------------------------------------------
describe("dominio — huella semántica (conferDecisionFingerprint)", () => {
  it("ignora el decisionId (es identidad, no intención)", () => {
    const a = conferDecision({ decisionId: "x", designatedWorkId: 7, contentClass: "MANGA" });
    const b = conferDecision({ decisionId: "y", designatedWorkId: 7, contentClass: "MANGA" });
    expect(conferDecisionFingerprint(a)).toBe(conferDecisionFingerprint(b));
  });
  it("es insensible al orden de las referencias semilla", () => {
    const a = conferDecision({ decisionId: "x", designatedWorkId: 7, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: "1" }, { provider: "mangaupdates", externalId: "2" }] });
    const b = conferDecision({ decisionId: "x", designatedWorkId: 7, contentClass: "MANGA", seedReferences: [{ provider: "mangaupdates", externalId: "2" }, { provider: "anilist", externalId: "1" }] });
    expect(conferDecisionFingerprint(a)).toBe(conferDecisionFingerprint(b));
  });
  it("distingue contenido, clase y referencias", () => {
    const base = conferDecision({ decisionId: "x", designatedWorkId: 7, contentClass: "MANGA" });
    const otherWork = conferDecision({ decisionId: "x", designatedWorkId: 8, contentClass: "MANGA" });
    const otherClass = conferDecision({ decisionId: "x", designatedWorkId: 7, contentClass: "COMIC" });
    const otherRefs = conferDecision({ decisionId: "x", designatedWorkId: 7, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: "1" }] });
    const fp = conferDecisionFingerprint(base);
    expect(conferDecisionFingerprint(otherWork)).not.toBe(fp);
    expect(conferDecisionFingerprint(otherClass)).not.toBe(fp);
    expect(conferDecisionFingerprint(otherRefs)).not.toBe(fp);
  });
});

// ---------------------------------------------------------------------------
// Traducción de conflicto P2002 (dependencia encapsulada de meta.target)
// ---------------------------------------------------------------------------
describe("infra — classifyConferConflict", () => {
  it("clasifica la forma array-de-campos (constraints del schema)", () => {
    expect(classifyConferConflict(["decisionId"])).toBe("DECISION_ID");
    expect(classifyConferConflict(["provider", "externalId"])).toBe("REFERENCE");
    expect(classifyConferConflict(["designatedWorkId"])).toBe("DESIGNATION");
  });
  it("clasifica la forma nombre-de-índice (índice parcial crudo)", () => {
    expect(classifyConferConflict("CatalogIdentity_decisionId_key")).toBe("DECISION_ID");
    expect(classifyConferConflict("CatalogIdentity_designatedWorkId_active_key")).toBe("DESIGNATION");
    expect(classifyConferConflict("IdentityExternalReference_provider_externalId_key")).toBe("REFERENCE");
  });
  it("no confunde designación con decisionId", () => {
    // 'designatedWorkId' no contiene la subcadena 'decisionId'
    expect(classifyConferConflict("designatedWorkId")).toBe("DESIGNATION");
  });
  it("target no reconocible → UNKNOWN", () => {
    expect(classifyConferConflict(undefined)).toBe("UNKNOWN");
    expect(classifyConferConflict("some_other_constraint")).toBe("UNKNOWN");
  });
});
