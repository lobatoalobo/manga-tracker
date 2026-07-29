/**
 * Integración de "absorber un Work" (ADR-008) contra Postgres REAL desechable (harness efímero; skip
 * sin `IDENTITY_TEST_DATABASE_URL`). El write-port se ejecuta SIEMPRE dentro de una tx controlada por
 * el test (`prisma.$transaction(tx => absorbWorkInTx(tx, cmd))`) — Catálogo no abre su propia tx.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { absorbWorkInTx, type CatalogAbsorbDb } from "@/lib/infra/catalog/absorbWork";
import { absorbWorkCommand } from "@/lib/domain/catalog/absorbWork";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — absorber Work (ADR-008, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `aw-${Date.now()}-${seq++}`;

  async function work(): Promise<number> {
    const t = uniq();
    return (await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } })).id;
  }
  async function edition(workId: number, publisher: string, language = "es"): Promise<number> {
    const t = uniq();
    return (await prisma.publisherEdition.create({ data: { workId, publisher, slug: `slug-${t}`, title: t, normTitle: t, volumes: 1, url: "", language }, select: { id: true } })).id;
  }
  const run = (s: number, a: number) => prisma.$transaction((tx) => absorbWorkInTx(tx as CatalogAbsorbDb, absorbWorkCommand({ survivingWorkId: s, absorbedWorkId: a })));

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.identityExternalReference.deleteMany({});
    await prisma.catalogIdentity.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    // limpiar absorciones antes de borrar Works (self-FK Restrict)
    await prisma.work.updateMany({ data: { absorbedIntoId: null } });
    await prisma.work.deleteMany({});
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- schema ---
  it("la self-FK acepta un absorbedIntoId válido; la autorreferencia es rechazada por el CHECK", async () => {
    const s = await work();
    const a = await work();
    await run(s, a);
    expect((await prisma.work.findUnique({ where: { id: a }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBe(s);
    await expect(prisma.$executeRawUnsafe(`UPDATE "Work" SET "absorbedIntoId"=${s} WHERE id=${s}`)).rejects.toBeTruthy(); // auto-absorción
  });

  it("el Work absorbido conserva su fila; el sobreviviente no puede borrarse (FK Restrict)", async () => {
    const s = await work();
    const a = await work();
    await run(s, a);
    expect(await prisma.work.findUnique({ where: { id: a } })).not.toBeNull(); // sin borrado físico
    await expect(prisma.work.delete({ where: { id: s } })).rejects.toBeTruthy(); // Restrict: a lo apunta
  });

  // --- flujo ---
  it("EXECUTED: re-parenta ediciones, marca el absorbido, no toca el sobreviviente", async () => {
    const s = await work();
    const a = await work();
    await edition(s, "Ivrea Argentina", "es");
    await edition(a, "VIZ", "en");
    await edition(a, "Ovni Press", "es");
    const r = await run(s, a);
    expect(r).toMatchObject({ kind: "EXECUTED", reparentedEditions: 2 });
    expect(await prisma.publisherEdition.count({ where: { workId: s } })).toBe(3);
    expect(await prisma.publisherEdition.count({ where: { workId: a } })).toBe(0);
    expect((await prisma.work.findUnique({ where: { id: a }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBe(s);
    expect((await prisma.work.findUnique({ where: { id: s }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBeNull();
  });

  it("idempotencia por estado: absorber dos veces → ALREADY_ABSORBED, sin cambios", async () => {
    const s = await work();
    const a = await work();
    expect((await run(s, a)).kind).toBe("EXECUTED");
    expect((await run(s, a)).kind).toBe("ALREADY_ABSORBED");
  });

  it("rechaza si el absorbido ya fue absorbido en OTRO destino", async () => {
    const s1 = await work();
    const s2 = await work();
    const a = await work();
    expect((await run(s1, a)).kind).toBe("EXECUTED");
    expect(await run(s2, a)).toMatchObject({ kind: "REJECTED", reason: "INVALID_ABSORBED_STATE" });
  });

  it("conflicto de slot de edición (publisher+idioma) → CONTENT_CONFLICT_REQUIRES_JUDGMENT, sin escritura", async () => {
    const s = await work();
    const a = await work();
    await edition(s, "Ivrea Argentina", "es");
    await edition(a, "Ivrea Argentina", "es");
    const r = await run(s, a);
    expect(r).toMatchObject({ kind: "REJECTED", reason: "CONTENT_CONFLICT_REQUIRES_JUDGMENT" });
    if (r.kind === "REJECTED") expect(r.conflicts).toEqual([{ publisher: "Ivrea Argentina", language: "es" }]);
    expect((await prisma.work.findUnique({ where: { id: a }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBeNull(); // no marcado
    expect(await prisma.publisherEdition.count({ where: { workId: a } })).toBe(1); // no movida
  });

  it("rollback: un fallo inyectado tras la absorción revierte todo", async () => {
    const s = await work();
    const a = await work();
    await edition(a, "VIZ", "en");
    await expect(
      prisma.$transaction(async (tx) => {
        await absorbWorkInTx(tx as CatalogAbsorbDb, absorbWorkCommand({ survivingWorkId: s, absorbedWorkId: a }));
        throw new Error("inject failure");
      }),
    ).rejects.toThrow("inject failure");
    expect((await prisma.work.findUnique({ where: { id: a }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBeNull();
    expect(await prisma.publisherEdition.count({ where: { workId: a } })).toBe(1); // no movida
  });

  it("NO modifica CatalogIdentity (una identidad que designa el absorbido queda intacta)", async () => {
    const s = await work();
    const a = await work();
    const ident = await prisma.catalogIdentity.create({ data: { state: "ACTIVE", contentClass: "MANGA", designatedWorkId: a, decisionId: uniq(), decisionFingerprint: uniq() }, select: { id: true, state: true } });
    await run(s, a);
    const after = await prisma.catalogIdentity.findUnique({ where: { id: ident.id }, select: { state: true, designatedWorkId: true } });
    expect(after).toEqual({ state: "ACTIVE", designatedWorkId: a }); // identidad sin tocar (Fusionar la coordinaría aparte)
  });

  // --- concurrencia ---
  it("carrera: mismo absorbido → dos sobrevivientes distintos → uno EXECUTED, uno rechazado", async () => {
    const s1 = await work();
    const s2 = await work();
    const a = await work();
    const [r1, r2] = await Promise.all([run(s1, a), run(s2, a)]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["EXECUTED", "REJECTED"]);
    // exactamente un sobreviviente terminó designado
    const abs = await prisma.work.findUnique({ where: { id: a }, select: { absorbedIntoId: true } });
    expect([s1, s2]).toContain(abs?.absorbedIntoId);
  });

  it("carrera: mismo absorbido → mismo sobreviviente → EXECUTED + ALREADY_ABSORBED", async () => {
    const s = await work();
    const a = await work();
    const [r1, r2] = await Promise.all([run(s, a), run(s, a)]);
    expect([r1.kind, r2.kind].sort()).toEqual(["ALREADY_ABSORBED", "EXECUTED"]);
  });

  it("carrera A→B vs B→A: una gana, la otra INVALID_SURVIVOR_STATE (sin ciclo)", async () => {
    const A = await work();
    const B = await work();
    const [r1, r2] = await Promise.all([run(A, B), run(B, A)]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["EXECUTED", "REJECTED"]);
    // no hay ciclo: a lo sumo uno quedó absorbido
    const absorbedCount = await prisma.work.count({ where: { id: { in: [A, B] }, absorbedIntoId: { not: null } } });
    expect(absorbedCount).toBe(1);
  });

  it("carrera: dos absorbidos distintos → mismo sobreviviente → ambos EXECUTED", async () => {
    const s = await work();
    const a1 = await work();
    const a2 = await work();
    const [r1, r2] = await Promise.all([run(s, a1), run(s, a2)]);
    expect(r1.kind).toBe("EXECUTED");
    expect(r2.kind).toBe("EXECUTED");
    expect(await prisma.work.count({ where: { absorbedIntoId: s } })).toBe(2);
  });
});
