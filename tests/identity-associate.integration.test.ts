/**
 * Integración de "Asociar una referencia externa" contra Postgres REAL desechable (mismo harness
 * efímero que Conferir; skip sin `IDENTITY_TEST_DATABASE_URL`). Prueba los invariantes globales y la
 * concurrencia que los dobles no pueden. Los destinos se materializan directamente (create de
 * CatalogIdentity), incluido un estado no-ACTIVE para verificar la regla de destino inválido — el
 * modelo permite representarlo (columna `state`), sin inventar un flujo productor (no hay Retirar).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { makeAssociateRegistro } from "@/lib/infra/identity/associateRegistro";
import { associateExternalReferenceDecision } from "@/lib/domain/identity/associate";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Asociar (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const registro = makeAssociateRegistro(prisma);

  let seq = 0;
  const uniq = () => `at-${Date.now()}-${seq++}`;

  async function makeIdentity(state = "ACTIVE"): Promise<number> {
    const title = uniq();
    const w = await prisma.work.create({ data: { title, normTitle: title.toLowerCase(), type: "MANGA" }, select: { id: true } });
    const i = await prisma.catalogIdentity.create({
      data: { state, contentClass: "MANGA", designatedWorkId: w.id, decisionId: uniq(), decisionFingerprint: uniq() },
      select: { id: true },
    });
    return i.id;
  }
  const decide = (targetHandle: number, over: { decisionId?: string; provider?: string; externalId?: string } = {}) =>
    associateExternalReferenceDecision({ decisionId: over.decisionId ?? uniq(), targetHandle, provider: over.provider ?? "mangaupdates", externalId: over.externalId ?? uniq() });

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => { await prisma.identityExternalReference.deleteMany({}); await prisma.catalogIdentity.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("asociación persistida", async () => {
    const h = await makeIdentity();
    const d = decide(h);
    const r = await registro.associate(d);
    expect(r.kind).toBe("EXECUTED");
    const row = await prisma.identityExternalReference.findUnique({ where: { provider_externalId: { provider: d.provider, externalId: d.externalId } } });
    expect(row?.identityId).toBe(h);
    expect(row?.decisionId).toBe(d.decisionId);
  });

  it("replay exacto → ALREADY_SATISFIED, sin segunda fila", async () => {
    const h = await makeIdentity();
    const d = decide(h);
    const a = await registro.associate(d);
    const b = await registro.associate(d);
    expect(a.kind).toBe("EXECUTED");
    expect(b.kind).toBe("ALREADY_SATISFIED");
    expect(await prisma.identityExternalReference.count({ where: { decisionId: d.decisionId } })).toBe(1);
  });

  it("reuso divergente del decisionId → REJECTED", async () => {
    const h = await makeIdentity();
    const id = uniq();
    const a = await registro.associate(decide(h, { decisionId: id, externalId: "x1" }));
    const b = await registro.associate(decide(h, { decisionId: id, externalId: "x2" }));
    expect(a.kind).toBe("EXECUTED");
    expect(b).toMatchObject({ kind: "REJECTED", invariant: "DECISION_ID_REUSED_DIVERGENTLY" });
  });

  it("misma referencia + mismo destino + decisión diferente → ALREADY_ASSOCIATED", async () => {
    const h = await makeIdentity();
    const ext = uniq();
    const a = await registro.associate(decide(h, { externalId: ext }));
    const b = await registro.associate(decide(h, { externalId: ext })); // otra decisión, mismo (ref, destino)
    expect(a.kind).toBe("EXECUTED");
    expect(b.kind).toBe("ALREADY_ASSOCIATED");
    expect(await prisma.identityExternalReference.count({ where: { provider: "mangaupdates", externalId: ext } })).toBe(1);
  });

  it("misma referencia + destino diferente → REFERENCE_ALREADY_BOUND", async () => {
    const h1 = await makeIdentity();
    const h2 = await makeIdentity();
    const ext = uniq();
    const a = await registro.associate(decide(h1, { externalId: ext }));
    const b = await registro.associate(decide(h2, { externalId: ext }));
    expect(a.kind).toBe("EXECUTED");
    expect(b).toMatchObject({ kind: "REJECTED", invariant: "REFERENCE_ALREADY_BOUND" });
  });

  it("concurrencia: misma referencia a destinos distintos → EXECUTED + REFERENCE_ALREADY_BOUND", async () => {
    const h1 = await makeIdentity();
    const h2 = await makeIdentity();
    const ext = uniq();
    const [a, b] = await Promise.all([
      registro.associate(decide(h1, { externalId: ext })),
      registro.associate(decide(h2, { externalId: ext })),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["EXECUTED", "REJECTED"]);
    const loser = a.kind === "REJECTED" ? a : b;
    if (loser.kind === "REJECTED") expect(loser.invariant).toBe("REFERENCE_ALREADY_BOUND");
    expect(await prisma.identityExternalReference.count({ where: { provider: "mangaupdates", externalId: ext } })).toBe(1); // atomicidad
  });

  it("concurrencia: misma decisión → EXECUTED + ALREADY_SATISFIED", async () => {
    const h = await makeIdentity();
    const d = decide(h);
    const [a, b] = await Promise.all([registro.associate(d), registro.associate(d)]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["ALREADY_SATISFIED", "EXECUTED"]);
    expect(await prisma.identityExternalReference.count({ where: { decisionId: d.decisionId } })).toBe(1);
  });

  it("handle destino inexistente → IDENTITY_NOT_FOUND, sin fila", async () => {
    const before = await prisma.identityExternalReference.count();
    const r = await registro.associate(decide(999999));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: "IDENTITY_NOT_FOUND" });
    expect(await prisma.identityExternalReference.count()).toBe(before);
  });

  it("destino en estado no-ACTIVE (materializado directo) → INVALID_IDENTITY_STATE", async () => {
    const retired = await makeIdentity("RETIRED");
    const r = await registro.associate(decide(retired));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: "INVALID_IDENTITY_STATE" });
    expect(await prisma.identityExternalReference.count({ where: { identityId: retired } })).toBe(0);
  });
});
