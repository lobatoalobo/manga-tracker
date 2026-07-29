/**
 * Tests de integración de "Conferir una Identity" contra una base REAL desechable.
 *
 * SKIP por default: solo corren si `IDENTITY_TEST_DATABASE_URL` apunta a una base Postgres
 * DESECHABLE con el schema aplicado (`prisma migrate deploy`). NUNCA la base compartida/prod.
 * Por eso `npm run check` (sin esa env) los saltea. Prueban lo que los dobles NO pueden: los
 * invariantes GLOBALES bajo intentos y concurrencia reales (restricciones únicas + traducción
 * P2002 → Resultado), que es exactamente donde los pre-checks en memoria no alcanzan.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { makeRegistro } from "@/lib/infra/identity/registro";
import { conferDecision } from "@/lib/domain/identity/confer";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Conferir (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const registro = makeRegistro(prisma);

  let seq = 0;
  const uniq = () => `it-${Date.now()}-${seq++}`;

  async function makeWork(type = "MANGA"): Promise<number> {
    const title = uniq();
    const w = await prisma.work.create({ data: { title, normTitle: title.toLowerCase(), type }, select: { id: true } });
    return w.id;
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`; // conexión temprana (falla ruidoso si la env está mal)
  });
  afterEach(async () => {
    await prisma.identityExternalReference.deleteMany({});
    await prisma.catalogIdentity.deleteMany({});
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persiste Identity + designación + referencias semilla", async () => {
    const workId = await makeWork();
    const r = await registro.confer(
      conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA", seedReferences: [{ provider: "mangaupdates", externalId: uniq() }] }),
    );
    expect(r.kind).toBe("EXECUTED");
    if (r.kind !== "EXECUTED") return;
    const row = await prisma.catalogIdentity.findUnique({ where: { id: r.identity.handle }, include: { externalRefs: true } });
    expect(row?.state).toBe("ACTIVE");
    expect(row?.designatedWorkId).toBe(workId);
    expect(row?.externalRefs).toHaveLength(1);
  });

  it("designación única: un segundo intento sobre el mismo contenido es REJECTED", async () => {
    const workId = await makeWork();
    const a = await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA" }));
    const b = await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA" }));
    expect(a.kind).toBe("EXECUTED");
    expect(b).toMatchObject({ kind: "REJECTED", invariant: "DESIGNATION_TAKEN" });
    expect(await prisma.catalogIdentity.count({ where: { designatedWorkId: workId } })).toBe(1);
  });

  it("unicidad de referencia: una segunda identidad con la misma referencia es REJECTED", async () => {
    const w1 = await makeWork();
    const w2 = await makeWork();
    const ref = uniq();
    const a = await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w1, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: ref }] }));
    const b = await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w2, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: ref }] }));
    expect(a.kind).toBe("EXECUTED");
    expect(b).toMatchObject({ kind: "REJECTED", invariant: "REFERENCE_ALREADY_BOUND" });
  });

  it("atomicidad: si una referencia semilla ya está ligada, NO nace la identidad", async () => {
    const w1 = await makeWork();
    const w2 = await makeWork();
    const taken = uniq();
    await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w1, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: taken }] }));
    const before = await prisma.catalogIdentity.count();
    const r = await registro.confer(
      conferDecision({ decisionId: uniq(), designatedWorkId: w2, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: uniq() }, { provider: "anilist", externalId: taken }] }),
    );
    expect(r.kind).toBe("REJECTED");
    expect(await prisma.catalogIdentity.count()).toBe(before); // ni identidad ni primera referencia
  });

  it("concurrencia: dos confer del MISMO contenido → uno EXECUTED, uno REJECTED", async () => {
    const workId = await makeWork();
    const [a, b] = await Promise.all([
      registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA" })),
      registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA" })),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["EXECUTED", "REJECTED"]);
    const loser = a.kind === "REJECTED" ? a : b;
    if (loser.kind === "REJECTED") expect(loser.invariant).toBe("DESIGNATION_TAKEN");
    expect(await prisma.catalogIdentity.count({ where: { designatedWorkId: workId } })).toBe(1);
  });

  it("concurrencia: dos confer con la MISMA referencia externa → uno EXECUTED, uno REJECTED", async () => {
    const w1 = await makeWork();
    const w2 = await makeWork();
    const ref = uniq();
    const mk = (workId: number) => conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA", seedReferences: [{ provider: "mangadex", externalId: ref }] });
    const [a, b] = await Promise.all([registro.confer(mk(w1)), registro.confer(mk(w2))]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["EXECUTED", "REJECTED"]);
    const loser = a.kind === "REJECTED" ? a : b;
    if (loser.kind === "REJECTED") expect(loser.invariant).toBe("REFERENCE_ALREADY_BOUND");
    expect(await prisma.identityExternalReference.count({ where: { provider: "mangadex", externalId: ref } })).toBe(1);
  });

  it("replay de la MISMA decisión → ALREADY_SATISFIED, sin segunda fila", async () => {
    const workId = await makeWork();
    const d = conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA" });
    const a = await registro.confer(d);
    const b = await registro.confer(d);
    expect(a.kind).toBe("EXECUTED");
    expect(b.kind).toBe("ALREADY_SATISFIED");
    if (a.kind === "EXECUTED" && b.kind === "ALREADY_SATISFIED") expect(b.identity.handle).toBe(a.identity.handle);
    expect(await prisma.catalogIdentity.count({ where: { designatedWorkId: workId } })).toBe(1);
  });

  it("concurrencia: replay simultáneo de la misma decisión → EXECUTED + ALREADY_SATISFIED", async () => {
    const workId = await makeWork();
    const d = conferDecision({ decisionId: uniq(), designatedWorkId: workId, contentClass: "MANGA" });
    const [a, b] = await Promise.all([registro.confer(d), registro.confer(d)]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["ALREADY_SATISFIED", "EXECUTED"]);
    expect(await prisma.catalogIdentity.count({ where: { designatedWorkId: workId } })).toBe(1);
  });

  it("reuso divergente del decisionId (contenido distinto) → REJECTED", async () => {
    const w1 = await makeWork();
    const w2 = await makeWork();
    const id = uniq();
    const a = await registro.confer(conferDecision({ decisionId: id, designatedWorkId: w1, contentClass: "MANGA" }));
    const b = await registro.confer(conferDecision({ decisionId: id, designatedWorkId: w2, contentClass: "MANGA" }));
    expect(a.kind).toBe("EXECUTED");
    expect(b).toMatchObject({ kind: "REJECTED", invariant: "DECISION_ID_REUSED_DIVERGENTLY" });
    expect(await prisma.catalogIdentity.count({ where: { decisionId: id } })).toBe(1);
  });

  it("mismas referencias en distinto orden con el mismo decisionId → ALREADY_SATISFIED", async () => {
    const workId = await makeWork();
    const id = uniq();
    const r1 = uniq();
    const r2 = uniq();
    const a = await registro.confer(conferDecision({ decisionId: id, designatedWorkId: workId, contentClass: "MANGA", seedReferences: [{ provider: "anilist", externalId: r1 }, { provider: "mangaupdates", externalId: r2 }] }));
    const b = await registro.confer(conferDecision({ decisionId: id, designatedWorkId: workId, contentClass: "MANGA", seedReferences: [{ provider: "mangaupdates", externalId: r2 }, { provider: "anilist", externalId: r1 }] }));
    expect(a.kind).toBe("EXECUTED");
    expect(b.kind).toBe("ALREADY_SATISFIED");
  });

  it("frescura de handle: monótono creciente y único a través de un intento abortado (contigüidad NO garantizada)", async () => {
    const w1 = await makeWork();
    const w2 = await makeWork();
    const w3 = await makeWork();
    const a = await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w1, contentClass: "MANGA" }));
    // carrera sobre w2: el perdedor consume un valor de sequence en un INSERT que aborta (hueco).
    const [x, y] = await Promise.all([
      registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w2, contentClass: "MANGA" })),
      registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w2, contentClass: "MANGA" })),
    ]);
    const c = await registro.confer(conferDecision({ decisionId: uniq(), designatedWorkId: w3, contentClass: "MANGA" }));
    const winner = x.kind === "EXECUTED" ? x : y;
    expect(a.kind).toBe("EXECUTED");
    expect(winner.kind).toBe("EXECUTED");
    expect(c.kind).toBe("EXECUTED");
    if (a.kind === "EXECUTED" && winner.kind === "EXECUTED" && c.kind === "EXECUTED") {
      const handles = [a.identity.handle, winner.identity.handle, c.identity.handle];
      expect(new Set(handles).size).toBe(3); // nunca reusa
      expect(handles[0]).toBeLessThan(handles[1]); // monótono
      expect(handles[1]).toBeLessThan(handles[2]); // (los huecos son válidos; no se asserta contigüidad)
    }
  });
});
