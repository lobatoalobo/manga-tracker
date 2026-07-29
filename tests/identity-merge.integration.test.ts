/**
 * Integración de "Fusionar dos identidades" (ADR-008 + ADR-009) contra Postgres REAL desechable
 * (harness efímero; skip sin `IDENTITY_TEST_DATABASE_URL`). Prueba lo que los dobles NO pueden: la
 * atomicidad cross-context (namespace + Catálogo) en UNA tx, los CHECK/FK crudos de redirección, el
 * orden de mutación forzado por la FK compuesta (ADR-009), la resolución de handles y las CARRERAS.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { makeMergeIdentities } from "@/lib/identity/mergeIdentities";
import { mergeDecision } from "@/lib/domain/identity/merge";
import { resolveIdentity } from "@/lib/infra/identity/resolveIdentity";
import { prepareIdentityMergeInTx, applyIdentityMergeInTx, type MergeDb } from "@/lib/infra/identity/mergeRegistro";
import { absorbWorkInTx, type CatalogAbsorbDb } from "@/lib/infra/catalog/absorbWork";
import { absorbWorkCommand } from "@/lib/domain/catalog/absorbWork";
import { makeAssociateRegistro } from "@/lib/infra/identity/associateRegistro";
import { associateExternalReferenceDecision } from "@/lib/domain/identity/associate";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Fusionar identidades (ADR-008/009, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const merge = makeMergeIdentities(prisma);
  let seq = 0;
  const uniq = () => `mg-${Date.now()}-${seq++}`;

  async function work(): Promise<number> {
    const t = uniq();
    return (await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } })).id;
  }
  async function edition(workId: number, publisher: string, language = "es"): Promise<number> {
    const t = uniq();
    return (await prisma.publisherEdition.create({ data: { workId, publisher, slug: `slug-${t}`, title: t, normTitle: t, volumes: 1, url: "", language }, select: { id: true } })).id;
  }
  async function identity(workId: number, contentClass = "MANGA"): Promise<number> {
    return (await prisma.catalogIdentity.create({ data: { state: "ACTIVE", contentClass, designatedWorkId: workId, decisionId: uniq(), decisionFingerprint: uniq() }, select: { id: true } })).id;
  }
  async function reference(identityId: number, provider: string, externalId: string): Promise<void> {
    await prisma.identityExternalReference.create({ data: { identityId, provider, externalId, identityState: "ACTIVE" } });
  }
  /** Crea dos Works + dos identidades ACTIVE (sobreviviente, absorbida). */
  async function pair(): Promise<{ sW: number; aW: number; s: number; a: number }> {
    const sW = await work();
    const aW = await work();
    return { sW, aW, s: await identity(sW), a: await identity(aW) };
  }
  const dec = (survivingHandle: number, absorbedHandle: number, decisionId = uniq()) => mergeDecision({ decisionId, survivingHandle, absorbedHandle });

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.identityExternalReference.deleteMany({});
    // desarmar redirecciones (state y redirect en el MISMO update para no violar el CHECK de coherencia)
    await prisma.catalogIdentity.updateMany({ data: { state: "ACTIVE", redirectsToId: null, mergeDecisionId: null, mergeDecisionFingerprint: null } });
    await prisma.catalogIdentity.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.updateMany({ data: { absorbedIntoId: null } });
    await prisma.work.deleteMany({});
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- fusión simple + postcondiciones (§21.2-9) ---
  it("fusión simple: absorbida REDIRECTED→sobreviviente, sobreviviente ACTIVE, refs+ediciones movidas, Work marcado", async () => {
    const { sW, aW, s, a } = await pair();
    await edition(sW, "Ivrea", "es");
    await edition(aW, "VIZ", "en");
    await reference(a, "anilist", uniq());
    await reference(a, "mangaupdates", uniq());
    const r = await merge.merge(dec(s, a));
    expect(r).toMatchObject({ kind: "EXECUTED", survivingHandle: s, absorbedHandle: a, survivingWorkId: sW, absorbedWorkId: aW, reparentedEditions: 1, movedReferences: 2 });

    const absId = await prisma.catalogIdentity.findUnique({ where: { id: a }, select: { state: true, redirectsToId: true, mergeDecisionId: true } });
    expect(absId).toMatchObject({ state: "REDIRECTED", redirectsToId: s });
    expect(absId?.mergeDecisionId).toBeTruthy();
    const survId = await prisma.catalogIdentity.findUnique({ where: { id: s }, select: { state: true, redirectsToId: true } });
    expect(survId).toEqual({ state: "ACTIVE", redirectsToId: null });
    // referencias movidas a la sobreviviente; ninguna sobre la absorbida (§21.18)
    expect(await prisma.identityExternalReference.count({ where: { identityId: a } })).toBe(0);
    expect(await prisma.identityExternalReference.count({ where: { identityId: s } })).toBe(2);
    // ediciones re-parentadas; Work absorbido marcado (§21.8-9)
    expect(await prisma.publisherEdition.count({ where: { workId: sW } })).toBe(2);
    expect((await prisma.work.findUnique({ where: { id: aW }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBe(sW);
  });

  it("resolución de lectura (§21.21): ambos handles resuelven a la sobreviviente terminal", async () => {
    const { s, a } = await pair();
    await merge.merge(dec(s, a));
    expect(await resolveIdentity(prisma, s)).toMatchObject({ kind: "ACTIVE", terminalHandle: s, redirected: false });
    expect(await resolveIdentity(prisma, a)).toMatchObject({ kind: "ACTIVE", terminalHandle: s, redirected: true });
    expect(await resolveIdentity(prisma, 999999)).toMatchObject({ kind: "NOT_FOUND" });
  });

  // --- idempotencia (§21.10-12) ---
  it("replay de la MISMA decisión → ALREADY_SATISFIED, sin doble redirección", async () => {
    const { s, a } = await pair();
    const d = dec(s, a);
    expect((await merge.merge(d)).kind).toBe("EXECUTED");
    expect((await merge.merge(d)).kind).toBe("ALREADY_SATISFIED");
    expect(await prisma.catalogIdentity.count({ where: { redirectsToId: s } })).toBe(1);
  });

  it("estado ya fusionado por OTRA decisión → ALREADY_MERGED (≠ replay)", async () => {
    const { s, a } = await pair();
    expect((await merge.merge(dec(s, a))).kind).toBe("EXECUTED");
    expect((await merge.merge(dec(s, a))).kind).toBe("ALREADY_MERGED"); // otro decisionId, mismo fin
  });

  it("reuso divergente del decisionId → DECISION_ID_REUSED_DIVERGENTLY", async () => {
    const { s, a } = await pair();
    const aW2 = await work();
    const a2 = await identity(aW2);
    const id = uniq();
    expect((await merge.merge(dec(s, a, id))).kind).toBe("EXECUTED");
    const r = await merge.merge(dec(s, a2, id)); // mismo decisionId, otra absorbida → otra huella
    expect(r).toMatchObject({ kind: "REJECTED", reason: "DECISION_ID_REUSED_DIVERGENTLY" });
  });

  // --- rechazos (§21.13-17) ---
  it("handle inexistente → IDENTITY_NOT_FOUND (indica cuál)", async () => {
    const w = await work();
    const s = await identity(w);
    expect(await merge.merge(dec(s, 888888))).toMatchObject({ kind: "REJECTED", reason: "IDENTITY_NOT_FOUND", missing: "absorbed" });
    expect(await merge.merge(dec(888888, s))).toMatchObject({ kind: "REJECTED", reason: "IDENTITY_NOT_FOUND", missing: "survivor" });
  });

  it("estados inválidos: sobreviviente ya redirigida → INVALID_SURVIVOR_STATE; absorbida ya redirigida → INVALID_ABSORBED_STATE", async () => {
    const { s, a } = await pair();
    await merge.merge(dec(s, a)); // a → s (a queda REDIRECTED, s sigue ACTIVE)
    const wc = await work();
    const c = await identity(wc);
    // usar la absorbida 'a' (REDIRECTED) como sobreviviente → INVALID_SURVIVOR_STATE
    expect(await merge.merge(dec(a, c))).toMatchObject({ kind: "REJECTED", reason: "INVALID_SURVIVOR_STATE" });
    // usar la absorbida 'a' (REDIRECTED) como absorbida hacia otra → INVALID_ABSORBED_STATE
    expect(await merge.merge(dec(c, a))).toMatchObject({ kind: "REJECTED", reason: "INVALID_ABSORBED_STATE" });
  });

  it("clase de contenido incompatible → CONTENT_CLASS_INCOMPATIBLE (no fusiona)", async () => {
    const sW = await work();
    const aW = await work();
    const s = await identity(sW, "MANGA");
    const a = await identity(aW, "COMIC");
    expect(await merge.merge(dec(s, a))).toMatchObject({ kind: "REJECTED", reason: "CONTENT_CLASS_INCOMPATIBLE" });
    expect((await prisma.catalogIdentity.findUnique({ where: { id: a }, select: { state: true } }))?.state).toBe("ACTIVE");
  });

  it("conflicto de contenido (slot de edición compartido) → CONTENT_CONFLICT_REQUIRES_JUDGMENT; nada se muta", async () => {
    const { sW, aW, s, a } = await pair();
    await edition(sW, "Ivrea", "es");
    await edition(aW, "Ivrea", "es"); // mismo slot (publisher, language)
    const r = await merge.merge(dec(s, a));
    expect(r).toMatchObject({ kind: "REJECTED", reason: "CONTENT_CONFLICT_REQUIRES_JUDGMENT" });
    if (r.kind === "REJECTED") expect(r.conflicts).toEqual([{ publisher: "Ivrea", language: "es" }]);
    // rollback total: identidad ACTIVE, Work no marcado, edición no movida
    expect((await prisma.catalogIdentity.findUnique({ where: { id: a }, select: { state: true } }))?.state).toBe("ACTIVE");
    expect((await prisma.work.findUnique({ where: { id: aW }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBeNull();
    expect(await prisma.publisherEdition.count({ where: { workId: aW } })).toBe(1);
  });

  it("redirección ENTRANTE bloqueante → REDIRECT_DEPENDENTS_PRESENT (v1 no encadena)", async () => {
    const { s, a } = await pair(); // fusionamos a → s
    const wz = await work();
    const z = await identity(wz);
    await merge.merge(dec(a, z)); // z → a (a recibe una redirección entrante)
    const r = await merge.merge(dec(s, a)); // ahora intentar a → s crearía cadena z→a→s
    expect(r).toMatchObject({ kind: "REJECTED", reason: "REDIRECT_DEPENDENTS_PRESENT" });
  });

  // --- atomicidad / fallos inyectados (§19, §21.20) ---
  it("rollback total: un fallo inyectado tras absorber+mutar revierte namespace Y Catálogo", async () => {
    const { sW, aW, s, a } = await pair();
    await edition(aW, "VIZ", "en");
    await reference(a, "anilist", uniq());
    await expect(
      prisma.$transaction(async (tx) => {
        const prepared = await prepareIdentityMergeInTx(tx as unknown as MergeDb, dec(s, a));
        if (prepared.kind !== "READY") throw new Error("unexpected");
        await absorbWorkInTx(tx as unknown as CatalogAbsorbDb, absorbWorkCommand({ survivingWorkId: sW, absorbedWorkId: aW }));
        await applyIdentityMergeInTx(tx as unknown as MergeDb, dec(s, a), prepared);
        throw new Error("inject failure");
      }),
    ).rejects.toThrow("inject failure");
    // nada quedó persistido
    expect((await prisma.catalogIdentity.findUnique({ where: { id: a }, select: { state: true } }))?.state).toBe("ACTIVE");
    expect((await prisma.work.findUnique({ where: { id: aW }, select: { absorbedIntoId: true } }))?.absorbedIntoId).toBeNull();
    expect(await prisma.identityExternalReference.count({ where: { identityId: a } })).toBe(1);
    expect(await prisma.publisherEdition.count({ where: { workId: aW } })).toBe(1);
  });

  // --- constraints de estado a nivel base (§21.19) ---
  it("constraint DB: insertar una referencia sobre una identidad REDIRECTED falla (FK compuesta ADR-009)", async () => {
    const { s, a } = await pair();
    await merge.merge(dec(s, a)); // a → REDIRECTED
    await expect(reference(a, "anilist", uniq())).rejects.toBeTruthy();
  });

  it("constraint DB: autorredirección y estado incoherente son rechazados por los CHECK", async () => {
    const w = await work();
    const i = await identity(w);
    await expect(prisma.$executeRawUnsafe(`UPDATE "CatalogIdentity" SET "redirectsToId"=${i} WHERE id=${i}`)).rejects.toBeTruthy(); // auto-redirect
    await expect(prisma.$executeRawUnsafe(`UPDATE "CatalogIdentity" SET "state"='REDIRECTED' WHERE id=${i}`)).rejects.toBeTruthy(); // REDIRECTED sin destino
  });

  // --- concurrencia (§18) ---
  it("carrera: mismo absorbido → dos sobrevivientes (A→B vs A→C) → uno EXECUTED, uno rechazado, sin cadena", async () => {
    const wA = await work(), wB = await work(), wC = await work();
    const iA = await identity(wA), iB = await identity(wB), iC = await identity(wC);
    const [r1, r2] = await Promise.all([merge.merge(dec(iB, iA)), merge.merge(dec(iC, iA))]);
    expect([r1.kind, r2.kind].sort()).toEqual(["EXECUTED", "REJECTED"]);
    const abs = await prisma.catalogIdentity.findUnique({ where: { id: iA }, select: { redirectsToId: true } });
    expect([iB, iC]).toContain(abs?.redirectsToId); // redirige a exactamente uno
    expect(await prisma.catalogIdentity.count({ where: { redirectsToId: iA } })).toBe(0); // nadie redirige al absorbido → sin cadena
  });

  it("carrera: misma decisión simultánea (A→B, A→B) → EXECUTED + ALREADY_SATISFIED", async () => {
    const { s, a } = await pair();
    const d = dec(s, a);
    const [r1, r2] = await Promise.all([merge.merge(d), merge.merge(d)]);
    expect([r1.kind, r2.kind].sort()).toEqual(["ALREADY_SATISFIED", "EXECUTED"]);
    expect(await prisma.catalogIdentity.count({ where: { redirectsToId: s } })).toBe(1);
  });

  it("carrera: mismo fin, distintas decisiones (A→B, A→B) → EXECUTED + ALREADY_MERGED", async () => {
    const { s, a } = await pair();
    const [r1, r2] = await Promise.all([merge.merge(dec(s, a)), merge.merge(dec(s, a))]);
    expect([r1.kind, r2.kind].sort()).toEqual(["ALREADY_MERGED", "EXECUTED"]);
  });

  it("carrera: direcciones opuestas (A→B vs B→A) → una EXECUTED, otra rechazada, exactamente una redirección, sin ciclo", async () => {
    const { s: iA, a: iB } = await pair();
    const [r1, r2] = await Promise.all([merge.merge(dec(iA, iB)), merge.merge(dec(iB, iA))]);
    expect([r1.kind, r2.kind].sort()).toEqual(["EXECUTED", "REJECTED"]);
    const redirected = await prisma.catalogIdentity.count({ where: { id: { in: [iA, iB] }, redirectsToId: { not: null } } });
    expect(redirected).toBe(1); // sin ciclo: a lo sumo una redirige
  });

  it("carrera: cadena potencial (A→B vs B→C) → una EXECUTED, otra rechazada, sin cadena", async () => {
    const wA = await work(), wB = await work(), wC = await work();
    const iA = await identity(wA), iB = await identity(wB), iC = await identity(wC);
    const [r1, r2] = await Promise.all([merge.merge(dec(iB, iA)), merge.merge(dec(iC, iB))]); // iA→iB y iB→iC
    expect([r1.kind, r2.kind].sort()).toEqual(["EXECUTED", "REJECTED"]);
    // no existe A→B→C: ninguna identidad redirige hacia una identidad que a su vez redirige
    const redirs = await prisma.catalogIdentity.findMany({ where: { redirectsToId: { not: null } }, select: { redirectsToId: true } });
    for (const row of redirs) {
      const target = await prisma.catalogIdentity.findUnique({ where: { id: row.redirectsToId! }, select: { redirectsToId: true } });
      expect(target?.redirectsToId).toBeNull(); // el destino es terminal
    }
  });

  it("carrera: sobreviviente compartida (A→C vs B→C) → ambas EXECUTED, C sigue ACTIVE", async () => {
    const wA = await work(), wB = await work(), wC = await work();
    const iA = await identity(wA), iB = await identity(wB), iC = await identity(wC);
    const [r1, r2] = await Promise.all([merge.merge(dec(iC, iA)), merge.merge(dec(iC, iB))]);
    expect(r1.kind).toBe("EXECUTED");
    expect(r2.kind).toBe("EXECUTED");
    expect((await prisma.catalogIdentity.findUnique({ where: { id: iC }, select: { state: true } }))?.state).toBe("ACTIVE");
    expect(await prisma.catalogIdentity.count({ where: { redirectsToId: iC } })).toBe(2);
  });

  it("carrera: Fusionar (A→B) vs Asociar una referencia nueva a la absorbida A → ninguna referencia queda sobre una REDIRECTED", async () => {
    const { s, a } = await pair();
    const assoc = makeAssociateRegistro(prisma);
    const ext = uniq();
    const [rm, ra] = await Promise.all([
      merge.merge(dec(s, a)),
      assoc.associate(associateExternalReferenceDecision({ decisionId: uniq(), targetHandle: a, provider: "anilist", externalId: ext })),
    ]);
    expect(rm.kind).toBe("EXECUTED");
    expect(["EXECUTED", "REJECTED"]).toContain(ra.kind); // asoció (antes de redirigir) o fue rechazada por la FK
    // invariante duro: NINGUNA referencia sobre una identidad REDIRECTED
    const redirected = await prisma.catalogIdentity.findMany({ where: { redirectsToId: { not: null } }, select: { id: true } });
    for (const row of redirected) expect(await prisma.identityExternalReference.count({ where: { identityId: row.id } })).toBe(0);
  });

  it("carrera: Fusionar concurrente con otra absorción del Work absorbido → una sola dirección de absorción del Work", async () => {
    const { sW, aW, s, a } = await pair();
    const wX = await work(); // destino alternativo de absorción, sin identidad
    const [rm] = await Promise.all([
      merge.merge(dec(s, a)),
      prisma.$transaction((tx) => absorbWorkInTx(tx as unknown as CatalogAbsorbDb, absorbWorkCommand({ survivingWorkId: wX, absorbedWorkId: aW }))).catch(() => null),
    ]);
    // el Work absorbido terminó absorbido en EXACTAMENTE un destino
    const abs = await prisma.work.findUnique({ where: { id: aW }, select: { absorbedIntoId: true } });
    expect([sW, wX, null]).toContain(abs?.absorbedIntoId);
    if (rm.kind === "REJECTED") {
      // si la fusión perdió la carrera del Work, la identidad quedó intacta (rollback)
      expect((await prisma.catalogIdentity.findUnique({ where: { id: a }, select: { state: true } }))?.state).toBe("ACTIVE");
    } else {
      expect(abs?.absorbedIntoId).toBe(sW);
    }
  });
});
