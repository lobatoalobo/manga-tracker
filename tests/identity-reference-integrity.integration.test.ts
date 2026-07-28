/**
 * Integración de la fortificación ADR-009 (integridad de referencias) contra Postgres REAL
 * desechable (harness efímero; skip sin `IDENTITY_TEST_DATABASE_URL`). Verifica la garantía
 * DECLARATIVA que los dobles no pueden: la FK compuesta, el CHECK, el ON UPDATE RESTRICT (orden
 * forzado), el rollback y la carrera Asociar-vs-transición-de-estado. La FK y el CHECK son la
 * guardia autoritativa incluso ante writes ajenos a los casos de uso.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { makeAssociateRegistro } from "@/lib/infra/identity/associateRegistro";
import { associateExternalReferenceDecision } from "@/lib/domain/identity/associate";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — integridad de referencias (ADR-009, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const registro = makeAssociateRegistro(prisma);
  let seq = 0;
  const uniq = () => `ri-${Date.now()}-${seq++}`;

  async function identity(state = "ACTIVE"): Promise<number> {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const i = await prisma.catalogIdentity.create({
      data: { state, contentClass: "MANGA", designatedWorkId: w.id, decisionId: uniq(), decisionFingerprint: uniq() },
      select: { id: true },
    });
    return i.id;
  }
  const decide = (h: number, ext = uniq()) =>
    associateExternalReferenceDecision({ decisionId: uniq(), targetHandle: h, provider: "mangaupdates", externalId: ext });

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => { await prisma.identityExternalReference.deleteMany({}); await prisma.catalogIdentity.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- persistencia y garantía declarativa ---
  it("Asociar a ACTIVE persiste identityState = ACTIVE", async () => {
    const h = await identity();
    const d = decide(h);
    expect((await registro.associate(d)).kind).toBe("EXECUTED");
    const row = await prisma.identityExternalReference.findUnique({ where: { provider_externalId: { provider: d.provider, externalId: d.externalId } }, select: { identityState: true } });
    expect(row?.identityState).toBe("ACTIVE");
  });

  it("el CHECK rechaza un identityState distinto de ACTIVE (write directo)", async () => {
    const h = await identity();
    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO "IdentityExternalReference"("identityId","identityState","provider","externalId","createdAt") VALUES (${h},'REDIRECTED','p','${uniq()}',now())`),
    ).rejects.toBeTruthy();
  });

  it("la FK compuesta rechaza una referencia directa hacia una Identity REDIRECTED", async () => {
    const red = await identity("REDIRECTED");
    // insert directo (write ajeno a los casos de uso) con identityState='ACTIVE' hacia una identidad REDIRECTED
    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO "IdentityExternalReference"("identityId","identityState","provider","externalId","createdAt") VALUES (${red},'ACTIVE','p','${uniq()}',now())`),
    ).rejects.toBeTruthy();
    expect(await prisma.identityExternalReference.count({ where: { identityId: red } })).toBe(0);
  });

  // --- Asociar (camino amable) ---
  it("Asociar a REDIRECTED (pre-check) → INVALID_IDENTITY_STATE, sin fila", async () => {
    const red = await identity("REDIRECTED");
    const r = await registro.associate(decide(red));
    expect(r).toMatchObject({ kind: "REJECTED", invariant: "INVALID_IDENTITY_STATE" });
    expect(await prisma.identityExternalReference.count({ where: { identityId: red } })).toBe(0);
  });

  it("Asociar a RETIRED (pre-check) → INVALID_IDENTITY_STATE", async () => {
    const ret = await identity("RETIRED");
    expect(await registro.associate(decide(ret))).toMatchObject({ kind: "REJECTED", invariant: "INVALID_IDENTITY_STATE" });
  });

  // --- orden forzado por ON UPDATE RESTRICT ---
  it("cambiar ACTIVE→REDIRECTED con una referencia presente FALLA (RESTRICT)", async () => {
    const h = await identity();
    await registro.associate(decide(h));
    await expect(prisma.$executeRawUnsafe(`UPDATE "CatalogIdentity" SET state='REDIRECTED' WHERE id=${h}`)).rejects.toBeTruthy();
    // sigue ACTIVE
    expect((await prisma.catalogIdentity.findUnique({ where: { id: h }, select: { state: true } }))?.state).toBe("ACTIVE");
  });

  it("orden correcto: mover la referencia a otra Identity ACTIVE y luego redirigir → OK", async () => {
    const src = await identity();
    const dst = await identity();
    const d = decide(src);
    await registro.associate(d);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE "IdentityExternalReference" SET "identityId"=${dst} WHERE "identityId"=${src}`);
      await tx.$executeRawUnsafe(`UPDATE "CatalogIdentity" SET state='REDIRECTED' WHERE id=${src}`);
    });
    expect((await prisma.catalogIdentity.findUnique({ where: { id: src }, select: { state: true } }))?.state).toBe("REDIRECTED");
    const row = await prisma.identityExternalReference.findUnique({ where: { provider_externalId: { provider: d.provider, externalId: d.externalId } }, select: { identityId: true } });
    expect(row?.identityId).toBe(dst);
  });

  it("rollback: fallo entre mover la referencia y redirigir restaura ambos", async () => {
    const src = await identity();
    const dst = await identity();
    const d = decide(src);
    await registro.associate(d);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "IdentityExternalReference" SET "identityId"=${dst} WHERE "identityId"=${src}`);
        throw new Error("inject failure before state change");
      }),
    ).rejects.toThrow("inject failure");
    // la referencia volvió a src; src sigue ACTIVE
    const row = await prisma.identityExternalReference.findUnique({ where: { provider_externalId: { provider: d.provider, externalId: d.externalId } }, select: { identityId: true } });
    expect(row?.identityId).toBe(src);
    expect((await prisma.catalogIdentity.findUnique({ where: { id: src }, select: { state: true } }))?.state).toBe("ACTIVE");
  });

  // --- carrera mínima representativa (Asociar vs transición de estado) ---
  it("carrera: Asociar vs flip a REDIRECTED → nunca queda referencia + REDIRECTED", async () => {
    const h = await identity();
    const d = decide(h);
    const results = await Promise.allSettled([
      registro.associate(d),
      prisma.$executeRawUnsafe(`UPDATE "CatalogIdentity" SET state='REDIRECTED' WHERE id=${h}`),
    ]);
    // ambas terminan (sin deadlock): allSettled nunca cuelga; verificamos que no haya rechazo inesperado de tipo deadlock
    const assoc = results[0];
    expect(assoc.status).toBe("fulfilled"); // associate SIEMPRE devuelve un resultado semántico (no lanza)

    const state = (await prisma.catalogIdentity.findUnique({ where: { id: h }, select: { state: true } }))?.state;
    const refCount = await prisma.identityExternalReference.count({ where: { identityId: h } });

    // Invariante final (cualquier serialización válida): NUNCA referencia + REDIRECTED.
    expect(refCount > 0 && state === "REDIRECTED").toBe(false);
    if (assoc.status === "fulfilled") {
      if (assoc.value.kind === "EXECUTED") {
        expect(state).toBe("ACTIVE"); // A ganó: la referencia quedó y el flip falló por RESTRICT
        expect(refCount).toBe(1);
      } else {
        expect(assoc.value).toMatchObject({ kind: "REJECTED", invariant: "INVALID_IDENTITY_STATE" }); // B ganó: A rechazada
        expect(refCount).toBe(0);
      }
    }
  });
});
