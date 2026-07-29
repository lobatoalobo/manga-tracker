/**
 * Integración de Collection — apply / idempotencia transaccional (Slice 8, ADR-010) contra Postgres REAL
 * desechable (harness efímero; skip sin `IDENTITY_TEST_DATABASE_URL`). Ejercita: primera aplicación, retry
 * idéntico, conflicto de payload, dos proyectores concurrentes de la MISMA adquisición, dos adquisiciones
 * distintas concurrentes sobre la misma posición, creación concurrente de una posición inexistente, rollback
 * total ante fallo entre insert e incremento, y carrera de eliminación del usuario (FK P2003).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { applyAcquisition } from "@/lib/collection-context/apply";
import { ACQUISITION_CHANNEL, type AcquisitionFact } from "@/lib/domain/collection/acquisition";
import { PROJECTION_RESULT } from "@/lib/domain/collection/result";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Collection apply (Slice 8, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `ca-${Date.now()}-${seq++}`;

  const mkUser = async () => (await prisma.user.create({ data: { email: `${uniq()}@ca.dev`, name: "C" }, select: { id: true } })).id;
  async function mkVolume() {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number: 1 }, select: { id: true } })).id;
  }
  const fact = (over: Partial<AcquisitionFact> & { userId: string; volumeId: number }): AcquisitionFact => ({
    acquisitionKey: `retail-pickup:${uniq()}`,
    quantity: 2,
    channel: ACQUISITION_CHANNEL.RETAIL_PICKUP,
    occurredAt: new Date("2026-08-01T10:00:00Z"),
    ...over,
  });
  const positionOf = (userId: string, volumeId: number) =>
    prisma.ownershipPosition.findUnique({ where: { userId_volumeId: { userId, volumeId } }, select: { quantity: true } });
  const acqCount = (acquisitionKey: string) => prisma.acquisition.count({ where: { acquisitionKey } });

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.acquisition.deleteMany({});
    await prisma.ownershipPosition.deleteMany({});
    await prisma.volume.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@ca.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("primera aplicación → APPLIED, crea posición e incrementa", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const f = fact({ userId, volumeId, quantity: 3 });
    expect(await applyAcquisition(f, prisma)).toBe(PROJECTION_RESULT.APPLIED);
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: 3 });
    expect(await acqCount(f.acquisitionKey)).toBe(1);
  });

  it("retry idéntico → ALREADY_APPLIED, sin doble conteo", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const f = fact({ userId, volumeId, quantity: 3 });
    await applyAcquisition(f, prisma);
    expect(await applyAcquisition(f, prisma)).toBe(PROJECTION_RESULT.ALREADY_APPLIED);
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: 3 });
    expect(await acqCount(f.acquisitionKey)).toBe(1);
  });

  it("misma clave con payload distinto → CONFLICT, sin cambios", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const f = fact({ userId, volumeId, quantity: 3 });
    await applyAcquisition(f, prisma);
    const conflicting: AcquisitionFact = { ...f, quantity: 5 }; // misma acquisitionKey, payload distinto
    expect(await applyAcquisition(conflicting, prisma)).toBe(PROJECTION_RESULT.CONFLICT);
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: 3 }); // sin cambios
    expect(await acqCount(f.acquisitionKey)).toBe(1);
  });

  it("dos proyectores concurrentes de la MISMA adquisición → 1 APPLIED + 1 ALREADY_APPLIED, contado una vez", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const f = fact({ userId, volumeId, quantity: 4 });
    const results = await Promise.all([applyAcquisition(f, prisma), applyAcquisition(f, prisma)]);
    expect([...results].sort()).toEqual([PROJECTION_RESULT.ALREADY_APPLIED, PROJECTION_RESULT.APPLIED].sort());
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: 4 });
    expect(await acqCount(f.acquisitionKey)).toBe(1);
  });

  it("dos adquisiciones DISTINTAS concurrentes sobre la misma posición → suma correcta", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const f1 = fact({ userId, volumeId, quantity: 2 });
    const f2 = fact({ userId, volumeId, quantity: 3 });
    const results = await Promise.all([applyAcquisition(f1, prisma), applyAcquisition(f2, prisma)]);
    expect(results).toEqual([PROJECTION_RESULT.APPLIED, PROJECTION_RESULT.APPLIED]);
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: 5 });
  });

  it("creación concurrente de una posición inexistente → una sola fila, suma correcta", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const fs = [1, 1, 1].map((q) => fact({ userId, volumeId, quantity: q })); // sin posición previa
    const results = await Promise.all(fs.map((f) => applyAcquisition(f, prisma)));
    expect(results).toEqual([PROJECTION_RESULT.APPLIED, PROJECTION_RESULT.APPLIED, PROJECTION_RESULT.APPLIED]);
    expect(await prisma.ownershipPosition.count({ where: { userId, volumeId } })).toBe(1); // exactamente UNA fila
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: 3 });
  });

  it("fallo entre insert e incremento (overflow del contador) → rollback TOTAL + RETRYABLE_FAILURE", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const INT_MAX = 2147483647; // el incremento desbordará INT4 DESPUÉS de insertar la Acquisition
    await prisma.ownershipPosition.create({ data: { userId, volumeId, quantity: INT_MAX } });
    const f = fact({ userId, volumeId, quantity: 1 });
    expect(await applyAcquisition(f, prisma)).toBe(PROJECTION_RESULT.RETRYABLE_FAILURE);
    // rollback total: la Acquisition NO persistió y la posición quedó intacta.
    expect(await acqCount(f.acquisitionKey)).toBe(0);
    expect(await positionOf(userId, volumeId)).toEqual({ quantity: INT_MAX });
  });

  it("usuario eliminado durante la operación (FK P2003) → TERMINALLY_NOT_APPLICABLE, sin estado", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const f = fact({ userId, volumeId, quantity: 2 });
    await prisma.user.delete({ where: { id: userId } }); // el destino desaparece antes de aplicar
    expect(await applyAcquisition(f, prisma)).toBe(PROJECTION_RESULT.TERMINALLY_NOT_APPLICABLE);
    expect(await acqCount(f.acquisitionKey)).toBe(0);
    expect(await positionOf(userId, volumeId)).toBeNull();
  });
});
