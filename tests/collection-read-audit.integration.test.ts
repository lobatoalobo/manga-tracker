/**
 * Integración de Collection — lecturas mínimas + auditoría/reparación (Slice 8, Paso 8) contra Postgres REAL
 * desechable (skip sin `IDENTITY_TEST_DATABASE_URL`). Lecturas: aislamiento por usuario/(userId,volumeId), orden
 * determinista. Auditoría: detección de drift, reparación con --repair, idempotencia, política ORPHAN_NONZERO y
 * seguridad ante una adquisición concurrente durante la reparación.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getUserPositions, getPositionAcquisitions } from "@/lib/collection-context/read";
import { detectOwnershipDrift, repairOwnershipPair, auditOwnership } from "@/lib/collection-context/audit";
import { applyAcquisition } from "@/lib/collection-context/apply";
import { ACQUISITION_CHANNEL, type AcquisitionFact } from "@/lib/domain/collection/acquisition";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Collection lecturas + auditoría (Slice 8, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `cr-${Date.now()}-${seq++}`;

  const mkUser = async () => (await prisma.user.create({ data: { email: `${uniq()}@cr.dev`, name: "R" }, select: { id: true } })).id;
  async function mkVolume() {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number: 1 }, select: { id: true } })).id;
  }
  const mkPos = (userId: string, volumeId: number, quantity: number) => prisma.ownershipPosition.create({ data: { userId, volumeId, quantity } });
  const mkAcq = (userId: string, volumeId: number, quantity: number, occurredAt: Date, keySuffix?: string) =>
    prisma.acquisition.create({ data: { acquisitionKey: `retail-pickup:${keySuffix ?? uniq()}`, userId, volumeId, quantity, channel: "RETAIL_PICKUP", occurredAt } });
  const fact = (o: { userId: string; volumeId: number; quantity: number }): AcquisitionFact => ({
    acquisitionKey: `retail-pickup:${uniq()}`, userId: o.userId, volumeId: o.volumeId, quantity: o.quantity,
    channel: ACQUISITION_CHANNEL.RETAIL_PICKUP, occurredAt: new Date("2026-08-01T10:00:00Z"),
  });
  const positionOf = (userId: string, volumeId: number) =>
    prisma.ownershipPosition.findUnique({ where: { userId_volumeId: { userId, volumeId } }, select: { quantity: true } });
  const sumOf = async (userId: string, volumeId: number) =>
    (await prisma.acquisition.aggregate({ where: { userId, volumeId }, _sum: { quantity: true } }))._sum.quantity ?? 0;

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.acquisition.deleteMany({});
    await prisma.ownershipPosition.deleteMany({});
    await prisma.volume.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@cr.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- Lecturas -------------------------------------------------------------------------------------------
  describe("lecturas mínimas", () => {
    it("getUserPositions aísla por usuario y nunca filtra datos de otro", async () => {
      const a = await mkUser(); const b = await mkUser();
      const v1 = await mkVolume(); const v2 = await mkVolume();
      await mkPos(a, v1, 2); await mkPos(a, v2, 3); await mkPos(b, v1, 9);
      const posA = await getUserPositions(prisma, a);
      expect(posA.map((p) => p.volumeId).sort((x, y) => x - y)).toEqual([v1, v2].sort((x, y) => x - y));
      expect(posA.find((p) => p.volumeId === v1)?.quantity).toBe(2); // no se filtra el 9 de B
      expect(posA[0].volume).toHaveProperty("number");
    });

    it("usuario sin posiciones → []", async () => {
      expect(await getUserPositions(prisma, await mkUser())).toEqual([]);
    });

    it("varias posiciones en orden determinista por volumeId", async () => {
      const a = await mkUser();
      const v1 = await mkVolume(); const v2 = await mkVolume(); const v3 = await mkVolume();
      await mkPos(a, v3, 1); await mkPos(a, v1, 1); await mkPos(a, v2, 1); // insertadas desordenadas
      const ids = (await getUserPositions(prisma, a)).map((p) => p.volumeId);
      expect(ids).toEqual([...ids].sort((x, y) => x - y)); // ascendente
    });

    it("getPositionAcquisitions aísla por (userId, volumeId) y devuelve los campos del hecho", async () => {
      const a = await mkUser(); const b = await mkUser();
      const v1 = await mkVolume(); const v2 = await mkVolume();
      await mkAcq(a, v1, 2, new Date("2026-01-01T00:00:00Z"));
      await mkAcq(a, v2, 3, new Date("2026-01-02T00:00:00Z"));
      await mkAcq(b, v1, 9, new Date("2026-01-03T00:00:00Z"));
      const h = await getPositionAcquisitions(prisma, a, v1);
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ userId: a, volumeId: v1, quantity: 2, channel: "RETAIL_PICKUP" });
      expect(h[0].acquisitionKey).toContain("retail-pickup:");
      expect(h[0].recordedAt).toBeInstanceOf(Date);
    });

    it("historial ordenado por occurredAt con desempate estable por id", async () => {
      const a = await mkUser(); const v1 = await mkVolume();
      const t = new Date("2026-01-01T00:00:00Z");
      await mkAcq(a, v1, 1, new Date("2026-03-01T00:00:00Z"), "late");
      await mkAcq(a, v1, 1, t, "early-1");
      await mkAcq(a, v1, 1, t, "early-2");
      const keys = (await getPositionAcquisitions(prisma, a, v1)).map((x) => x.acquisitionKey);
      expect(keys).toEqual(["retail-pickup:early-1", "retail-pickup:early-2", "retail-pickup:late"]);
    });
  });

  // --- Auditoría / reparación ------------------------------------------------------------------------------
  describe("auditoría y reparación", () => {
    it("base consistente → sin drift", async () => {
      const a = await mkUser(); const v = await mkVolume();
      await applyAcquisition(fact({ userId: a, volumeId: v, quantity: 2 }), prisma);
      expect(await detectOwnershipDrift(prisma)).toEqual([]);
    });

    it("cantidad incorrecta → MISMATCH; sin --repair no cambia; con --repair se corrige", async () => {
      const a = await mkUser(); const v = await mkVolume();
      await applyAcquisition(fact({ userId: a, volumeId: v, quantity: 2 }), prisma);
      await prisma.ownershipPosition.update({ where: { userId_volumeId: { userId: a, volumeId: v } }, data: { quantity: 5 } });
      const dry = await auditOwnership(prisma, {});
      expect(dry.drifts).toMatchObject([{ userId: a, volumeId: v, kind: "MISMATCH", positionQuantity: 5, acquisitionsSum: 2 }]);
      expect(await positionOf(a, v)).toEqual({ quantity: 5 }); // dry no tocó nada
      const rep = await auditOwnership(prisma, { repair: true });
      expect(rep.repaired).toBe(1);
      expect(await positionOf(a, v)).toEqual({ quantity: 2 });
    });

    it("posición faltante con adquisiciones → MISSING, creada con --repair", async () => {
      const a = await mkUser(); const v = await mkVolume();
      await mkAcq(a, v, 4, new Date("2026-02-01T00:00:00Z")); // adquisición sin posición
      const drifts = await detectOwnershipDrift(prisma);
      expect(drifts).toMatchObject([{ kind: "MISSING", positionQuantity: null, acquisitionsSum: 4 }]);
      await auditOwnership(prisma, { repair: true });
      expect(await positionOf(a, v)).toEqual({ quantity: 4 });
    });

    it("posición sin adquisiciones (nonzero) → ORPHAN_NONZERO, llevada a 0 sin borrar la fila", async () => {
      const a = await mkUser(); const v = await mkVolume();
      await mkPos(a, v, 3); // posición sin adquisiciones
      const drifts = await detectOwnershipDrift(prisma);
      expect(drifts).toMatchObject([{ kind: "ORPHAN_NONZERO", positionQuantity: 3, acquisitionsSum: 0 }]);
      await auditOwnership(prisma, { repair: true });
      expect(await positionOf(a, v)).toEqual({ quantity: 0 }); // a 0, NO borrada
    });

    it("segunda ejecución de --repair no cambia nada (idempotente)", async () => {
      const a = await mkUser(); const v = await mkVolume();
      await mkAcq(a, v, 4, new Date("2026-02-01T00:00:00Z"));
      await auditOwnership(prisma, { repair: true });
      const second = await auditOwnership(prisma, { repair: true });
      expect(second.drifts).toEqual([]); // ya consistente
      expect(await positionOf(a, v)).toEqual({ quantity: 4 });
    });

    it("adquisición concurrente durante la reparación no se pierde del total final", async () => {
      const a = await mkUser(); const v = await mkVolume();
      await applyAcquisition(fact({ userId: a, volumeId: v, quantity: 2 }), prisma); // posición=2, Σ=2
      // Carrera: reparar (recompute+lock+set) mientras entra otra adquisición (+3).
      await Promise.all([
        repairOwnershipPair(prisma, a, v),
        applyAcquisition(fact({ userId: a, volumeId: v, quantity: 3 }), prisma),
      ]);
      const finalSum = await sumOf(a, v);
      expect(finalSum).toBe(5);
      expect(await positionOf(a, v)).toEqual({ quantity: finalSum }); // nada perdido: posición == Σ
    });
  });
});
