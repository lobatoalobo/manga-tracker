/**
 * F2.2 — Executor de backfill legado → Collection (ADR-012) contra Postgres REAL desechable (skip sin
 * `IDENTITY_TEST_DATABASE_URL`). Verifica: migra SOLO RESOLVABLE; cero escrituras para los otros cuatro buckets;
 * no toca catálogo; respeta posiciones existentes (incl. quantity 0); idempotencia/reejecución; concurrencia;
 * conflicto explícito ante inconsistencia; invariante Σbuckets==total.
 *
 * La clasificación es la MISMA del dry-run (`scanUser` + `resolveCorrespondence`). No se prueban estados que la DB
 * no permite (Acquisition exige quantity>0; OwnershipPosition permite quantity>=0).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { legacyOwnershipSource } from "@/lib/collection-read/adapters/legacy";
import { catalogUniverseSource } from "@/lib/collection-read/adapters/catalog-universe";
import { accumulate, assertCardinality, bucketSum, emptyAggregate, scanUser } from "@/lib/collection-read/backfill-scan";
import { buildCorrespondenceIndex, resolveCorrespondence } from "@/lib/collection-read/mapping/correspondence";
import {
  BACKFILL_RESULT,
  buildLegacyBackfillFact,
  establishLegacyPresence,
  legacyBackfillAcquisitionKey,
  LEGACY_BACKFILL_OCCURRED_AT,
  type BackfillResult,
} from "@/lib/collection-context/backfill";
import { ACQUISITION_CHANNEL } from "@/lib/domain/collection/acquisition";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("F2.2 — executor de backfill (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `bfr-${Date.now()}-${seq++}`;
  const createdWorkIds: number[] = [];

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@bfrun.dev`, name: "BFR" }, select: { id: true } })).id;

  /** Siembra PublisherEdition (+Work para limpieza) + Volume. Devuelve mapa número→volumeId. */
  async function seedCatalog(o: { anilistId?: number | null; publisher: string; volumes: number[] }): Promise<Map<number, number>> {
    const w = await prisma.work.create({ data: { title: uniq(), normTitle: uniq() }, select: { id: true } });
    createdWorkIds.push(w.id);
    const ed = await prisma.publisherEdition.create({
      data: {
        publisher: o.publisher, slug: uniq(), title: uniq(), normTitle: uniq(), url: `https://x/${uniq()}`,
        volumes: o.volumes.length, anilistId: o.anilistId ?? null, workId: w.id,
      },
      select: { id: true },
    });
    const map = new Map<number, number>();
    for (const n of o.volumes) {
      const v = await prisma.volume.create({ data: { editionId: ed.id, number: n }, select: { id: true } });
      map.set(n, v.id);
    }
    return map;
  }

  /** Siembra el eje legado: Manga + TrackedEdition + OwnedVolume. */
  async function seedLegacy(userId: string, o: { anilistId: number; key: string; publisher?: string | null; volumes: number[] }): Promise<void> {
    const m = await prisma.manga.upsert({
      where: { userId_anilistId: { userId, anilistId: o.anilistId } },
      update: {}, create: { userId, anilistId: o.anilistId, romajiTitle: uniq(), coverImage: "" }, select: { id: true },
    });
    const ed = await prisma.trackedEdition.create({
      data: { mangaId: m.id, key: o.key, label: o.key, publisher: o.publisher ?? null, totalVolumes: o.volumes.length },
      select: { id: true },
    });
    if (o.volumes.length) await prisma.ownedVolume.createMany({ data: o.volumes.map((v) => ({ editionId: ed.id, volume: v })) });
  }

  type Tally = Record<BackfillResult, number>;
  const emptyTally = (): Tally => ({ APPLIED: 0, ALREADY_APPLIED: 0, ALREADY_PRESENT: 0, CONFLICT: 0, TERMINAL: 0, RETRYABLE: 0 });

  /** Corre el executor para un usuario (mismo pipeline que el script): clasifica y aplica solo RESOLVABLE. */
  async function runBackfillFor(userId: string): Promise<{ tally: Tally; resolvable: number }> {
    const obs = await legacyOwnershipSource(prisma).observe(userId);
    const anilistIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a > 0))];
    const workIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a < 0).map((a) => -a))];
    const uni = await catalogUniverseSource(prisma).forAnchors(anilistIds, workIds);
    const matched = resolveCorrespondence(buildCorrespondenceIndex(uni.volumes, obs)).matched;
    const tally = emptyTally();
    for (const m of matched) tally[await establishLegacyPresence(buildLegacyBackfillFact(userId, m.volumeId), prisma)]++;
    return { tally, resolvable: matched.length };
  }

  const posCount = (userId: string) => prisma.ownershipPosition.count({ where: { userId } });
  const acqCount = (userId: string) => prisma.acquisition.count({ where: { userId } });

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    // Borrar usuarios primero: cascada legado + OwnershipPosition + Acquisition (userId Cascade) → libera los Volume.
    await prisma.user.deleteMany({ where: { email: { contains: "@bfrun.dev" } } });
    if (createdWorkIds.length) {
      await prisma.publisherEdition.deleteMany({ where: { workId: { in: createdWorkIds } } }); // cascade Volume
      await prisma.work.deleteMany({ where: { id: { in: createdWorkIds } } });
      createdWorkIds.length = 0;
    }
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("RESOLVABLE migra: crea OwnershipPosition(q=1) + Acquisition (channel/clave/occurredAt correctos)", async () => {
    const u = await mkUser();
    const vols = await seedCatalog({ anilistId: 8001, publisher: "Ivrea Argentina", volumes: [1, 2] });
    await seedLegacy(u, { anilistId: 8001, key: "ivrea", volumes: [1, 2] });

    const { tally, resolvable } = await runBackfillFor(u);
    expect(resolvable).toBe(2);
    expect(tally.APPLIED).toBe(2);
    expect(await posCount(u)).toBe(2);
    expect(await acqCount(u)).toBe(2);

    const v1 = vols.get(1)!;
    const pos = await prisma.ownershipPosition.findUnique({ where: { userId_volumeId: { userId: u, volumeId: v1 } } });
    expect(pos?.quantity).toBe(1);
    const acq = await prisma.acquisition.findUnique({ where: { acquisitionKey: legacyBackfillAcquisitionKey(u, v1) } });
    expect(acq?.channel).toBe(ACQUISITION_CHANNEL.LEGACY_BACKFILL);
    expect(acq?.quantity).toBe(1);
    expect(acq?.occurredAt.getTime()).toBe(LEGACY_BACKFILL_OCCURRED_AT.getTime());
    expect(acq?.volumeId).toBe(v1);
  });

  it("buckets no-resolubles → CERO escrituras (AMBIGUOUS/ORPHAN_NO_EDITION/ORPHAN_NO_VOLUME/EDITION_KEY_MISMATCH)", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 8101, publisher: "Panini Argentina", volumes: [1] }); // key mismatch
    await seedCatalog({ anilistId: 8102, publisher: "Ivrea Argentina", volumes: [1] }); // falta vol 2 (posee 2)
    await seedCatalog({ anilistId: 8103, publisher: "Ivrea Argentina", volumes: [1] });
    await seedCatalog({ anilistId: 8103, publisher: "Ivrea Argentina", volumes: [1] }); // colisión → ambiguous
    await seedLegacy(u, { anilistId: 8101, key: "ivrea", volumes: [1] }); // EDITION_KEY_MISMATCH
    await seedLegacy(u, { anilistId: 8102, key: "ivrea", volumes: [2] }); // ORPHAN_NO_VOLUME
    await seedLegacy(u, { anilistId: 8103, key: "ivrea", volumes: [1] }); // AMBIGUOUS
    await seedLegacy(u, { anilistId: 8104, key: "ivrea", volumes: [1] }); // ORPHAN_NO_EDITION

    const before = { pos: await prisma.ownershipPosition.count(), acq: await prisma.acquisition.count() };
    const { tally, resolvable } = await runBackfillFor(u);
    expect(resolvable).toBe(0);
    expect(tally).toEqual(emptyTally());
    expect(await posCount(u)).toBe(0);
    expect(await acqCount(u)).toBe(0);
    const after = { pos: await prisma.ownershipPosition.count(), acq: await prisma.acquisition.count() };
    expect(after).toEqual(before);
  });

  it("no modifica el catálogo: PublisherEdition/Volume/OwnedVolume sin cambios", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 8201, publisher: "Ivrea Argentina", volumes: [1] });
    await seedLegacy(u, { anilistId: 8201, key: "ivrea", volumes: [1] });
    const before = { ed: await prisma.publisherEdition.count(), vol: await prisma.volume.count(), owned: await prisma.ownedVolume.count() };
    await runBackfillFor(u);
    const after = { ed: await prisma.publisherEdition.count(), vol: await prisma.volume.count(), owned: await prisma.ownedVolume.count() };
    expect(after).toEqual(before);
  });

  it("idempotencia: reejecutar da ALREADY_APPLIED, sin duplicar ni cambiar quantity", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 8301, publisher: "Ivrea Argentina", volumes: [1] });
    await seedLegacy(u, { anilistId: 8301, key: "ivrea", volumes: [1] });

    const r1 = await runBackfillFor(u);
    expect(r1.tally.APPLIED).toBe(1);
    const r2 = await runBackfillFor(u);
    expect(r2.tally.ALREADY_APPLIED).toBe(1);
    expect(r2.tally.APPLIED).toBe(0);
    expect(await posCount(u)).toBe(1);
    expect(await acqCount(u)).toBe(1);
    const v = (await prisma.ownershipPosition.findFirst({ where: { userId: u } }))!;
    expect(v.quantity).toBe(1);
  });

  it("posición preexistente de otra fuente (incl. quantity 0) → ALREADY_PRESENT, no se incrementa ni crea Acquisition", async () => {
    for (const q of [0, 1]) {
      const u = await mkUser();
      const vols = await seedCatalog({ anilistId: 8400 + q, publisher: "Ivrea Argentina", volumes: [1] });
      await seedLegacy(u, { anilistId: 8400 + q, key: "ivrea", volumes: [1] });
      const v1 = vols.get(1)!;
      await prisma.ownershipPosition.create({ data: { userId: u, volumeId: v1, quantity: q } }); // otra fuente

      const { tally } = await runBackfillFor(u);
      expect(tally.ALREADY_PRESENT).toBe(1);
      expect(tally.APPLIED).toBe(0);
      const pos = await prisma.ownershipPosition.findUnique({ where: { userId_volumeId: { userId: u, volumeId: v1 } } });
      expect(pos?.quantity).toBe(q); // NO incrementada
      expect(await prisma.acquisition.count({ where: { acquisitionKey: legacyBackfillAcquisitionKey(u, v1) } })).toBe(0);
    }
  });

  it("dos ejecuciones concurrentes del mismo backfill → una APPLIED, una ALREADY_APPLIED; posición y Acquisition únicas", async () => {
    const u = await mkUser();
    const vols = await seedCatalog({ anilistId: 8500, publisher: "Ivrea Argentina", volumes: [1] });
    const v1 = vols.get(1)!;
    const fact = buildLegacyBackfillFact(u, v1);

    const [a, b] = await Promise.all([establishLegacyPresence(fact, prisma), establishLegacyPresence(fact, prisma)]);
    expect([a, b].sort()).toEqual([BACKFILL_RESULT.ALREADY_APPLIED, BACKFILL_RESULT.APPLIED].sort());
    expect(await prisma.ownershipPosition.count({ where: { userId: u, volumeId: v1 } })).toBe(1);
    expect(await prisma.acquisition.count({ where: { acquisitionKey: legacyBackfillAcquisitionKey(u, v1) } })).toBe(1);
    const pos = await prisma.ownershipPosition.findUnique({ where: { userId_volumeId: { userId: u, volumeId: v1 } } });
    expect(pos?.quantity).toBe(1);
  });

  it("Acquisition de backfill existe pero posición ausente (mismo payload) → CONFLICT, no recrea la posición", async () => {
    const u = await mkUser();
    const vols = await seedCatalog({ anilistId: 8600, publisher: "Ivrea Argentina", volumes: [1] });
    const v1 = vols.get(1)!;
    const fact = buildLegacyBackfillFact(u, v1);
    await prisma.acquisition.create({ data: { ...fact } }); // acquisition sin su OwnershipPosition

    const res = await establishLegacyPresence(fact, prisma);
    expect(res).toBe(BACKFILL_RESULT.CONFLICT);
    expect(await prisma.ownershipPosition.count({ where: { userId: u, volumeId: v1 } })).toBe(0); // NO creada
  });

  it("acquisitionKey reusada con payload distinto → CONFLICT, sin crear posición", async () => {
    const u = await mkUser();
    const vols = await seedCatalog({ anilistId: 8700, publisher: "Ivrea Argentina", volumes: [1] });
    const v1 = vols.get(1)!;
    const key = legacyBackfillAcquisitionKey(u, v1);
    // Misma clave, payload distinto (quantity 2 / channel / occurredAt real), sin posición.
    await prisma.acquisition.create({
      data: { acquisitionKey: key, userId: u, volumeId: v1, quantity: 2, channel: "OTRO", occurredAt: new Date("2025-01-01T00:00:00.000Z") },
    });

    const res = await establishLegacyPresence(buildLegacyBackfillFact(u, v1), prisma);
    expect(res).toBe(BACKFILL_RESULT.CONFLICT);
    expect(await prisma.ownershipPosition.count({ where: { userId: u, volumeId: v1 } })).toBe(0);
  });

  it("invariante Σbuckets==total sobre mezcla; solo RESOLVABLE escribe", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 9001, publisher: "Ivrea Argentina", volumes: [1] }); // resoluble
    await seedCatalog({ anilistId: 9002, publisher: "Panini Argentina", volumes: [1] }); // mismatch
    await seedLegacy(u, { anilistId: 9001, key: "ivrea", volumes: [1] }); // RESOLVABLE
    await seedLegacy(u, { anilistId: 9002, key: "ivrea", volumes: [1] }); // EDITION_KEY_MISMATCH
    await seedLegacy(u, { anilistId: 9003, key: "ivrea", volumes: [1] }); // ORPHAN_NO_EDITION

    const obs = await legacyOwnershipSource(prisma).observe(u);
    const anilistIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a > 0))];
    const uni = await catalogUniverseSource(prisma).forAnchors(anilistIds, []);
    const agg = emptyAggregate();
    accumulate(agg, scanUser(obs, uni.volumes, uni.editions));
    expect(bucketSum(agg)).toBe(agg.total);
    expect(() => assertCardinality(agg)).not.toThrow();
    expect(agg.total).toBe(3);
    expect(agg.counts.RESOLVABLE).toBe(1);

    const { tally, resolvable } = await runBackfillFor(u);
    expect(resolvable).toBe(agg.counts.RESOLVABLE);
    expect(tally.APPLIED).toBe(1);
    expect(await posCount(u)).toBe(1); // solo el RESOLVABLE
    expect(await acqCount(u)).toBe(1);
  });
});
