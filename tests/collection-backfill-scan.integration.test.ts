/**
 * F2 PR-1 — Scan de backfilleabilidad (`lib/collection-read/backfill-scan.ts`) contra Postgres REAL desechable
 * (skip sin `IDENTITY_TEST_DATABASE_URL`). Verifica la clasificación por bucket, la invariante de cardinalidad, el
 * aislamiento por usuario, la idempotencia sobre el mismo snapshot y que el scan NO escribe. READ-ONLY.
 *
 * Buckets: RESOLVABLE | AMBIGUOUS | ORPHAN_NO_EDITION | EDITION_KEY_MISMATCH | ORPHAN_NO_VOLUME.
 * No fija IDs generados ni orden accidental: asserta por conteos de bucket e invariante.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { legacyOwnershipSource } from "@/lib/collection-read/adapters/legacy";
import { catalogUniverseSource } from "@/lib/collection-read/adapters/catalog-universe";
import {
  accumulate,
  assertCardinality,
  BACKFILL_BUCKETS,
  bucketSum,
  emptyAggregate,
  formatReport,
  scanUser,
  type UserScanResult,
} from "@/lib/collection-read/backfill-scan";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("F2 PR-1 — scan de backfilleabilidad (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `bf-${Date.now()}-${seq++}`;
  const createdWorkIds: number[] = [];

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@bfscan.dev`, name: "BF" }, select: { id: true } })).id;

  /** Siembra una PublisherEdition (con Work para limpieza) + sus Volume. Devuelve el workId. */
  async function seedCatalog(o: { anilistId?: number | null; publisher: string; volumes: number[] }): Promise<number> {
    const w = await prisma.work.create({ data: { title: uniq(), normTitle: uniq() }, select: { id: true } });
    createdWorkIds.push(w.id);
    const ed = await prisma.publisherEdition.create({
      data: {
        publisher: o.publisher,
        slug: uniq(),
        title: uniq(),
        normTitle: uniq(),
        url: `https://x/${uniq()}`,
        volumes: o.volumes.length,
        anilistId: o.anilistId ?? null,
        workId: w.id,
      },
      select: { id: true },
    });
    if (o.volumes.length) {
      await prisma.volume.createMany({ data: o.volumes.map((n) => ({ editionId: ed.id, number: n })) });
    }
    return w.id;
  }

  /** Siembra el eje legado: Manga + TrackedEdition + OwnedVolume. */
  async function seedLegacy(
    userId: string,
    o: { anilistId: number; key: string; publisher?: string | null; volumes: number[] },
  ): Promise<void> {
    const m = await prisma.manga.upsert({
      where: { userId_anilistId: { userId, anilistId: o.anilistId } },
      update: {},
      create: { userId, anilistId: o.anilistId, romajiTitle: uniq(), coverImage: "" },
      select: { id: true },
    });
    const ed = await prisma.trackedEdition.create({
      data: { mangaId: m.id, key: o.key, label: o.key, publisher: o.publisher ?? null, totalVolumes: o.volumes.length },
      select: { id: true },
    });
    if (o.volumes.length) {
      await prisma.ownedVolume.createMany({ data: o.volumes.map((v) => ({ editionId: ed.id, volume: v })) });
    }
  }

  /** Corre el scan real (adapters + función pura) para un usuario. */
  async function scanFor(userId: string): Promise<UserScanResult> {
    const obs = await legacyOwnershipSource(prisma).observe(userId);
    const anilistIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a > 0))];
    const workIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a < 0).map((a) => -a))];
    const uni = await catalogUniverseSource(prisma).forAnchors(anilistIds, workIds);
    return scanUser(obs, uni.volumes, uni.editions);
  }

  const expectCardinality = (r: UserScanResult) =>
    expect(BACKFILL_BUCKETS.reduce((s, b) => s + r.counts[b], 0)).toBe(r.total);

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@bfscan.dev" } } }); // cascade legado
    if (createdWorkIds.length) {
      await prisma.publisherEdition.deleteMany({ where: { workId: { in: createdWorkIds } } }); // cascade Volume
      await prisma.work.deleteMany({ where: { id: { in: createdWorkIds } } });
      createdWorkIds.length = 0;
    }
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("positivo resoluble (1 legado ↔ 1 Volume)", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 5001, publisher: "Ivrea Argentina", volumes: [1, 2] });
    await seedLegacy(u, { anilistId: 5001, key: "ivrea", volumes: [1, 2] });

    const r = await scanFor(u);
    expect(r.counts.RESOLVABLE).toBe(2);
    expect(r.total).toBe(2);
    expectCardinality(r);
  });

  it("identificador local negativo (-workId) resoluble", async () => {
    const u = await mkUser();
    const w = await seedCatalog({ anilistId: null, publisher: "Ivrea Argentina", volumes: [1] });
    await seedLegacy(u, { anilistId: -w, key: "ivrea", volumes: [1] });

    const r = await scanFor(u);
    expect(r.counts.RESOLVABLE).toBe(1);
    expectCardinality(r);
  });

  it("precedencia anilistId sobre workId: edición keyada en positivo → ORPHAN_NO_EDITION en ancla negativa", async () => {
    const u = await mkUser();
    // Edición con anilistId>0 Y workId: deriveCatalogKey elige el positivo, invisible al ancla legada -workId.
    const w = await seedCatalog({ anilistId: 5003, publisher: "Ivrea Argentina", volumes: [1] });
    await seedLegacy(u, { anilistId: -w, key: "ivrea", volumes: [1] });

    const r = await scanFor(u);
    expect(r.counts.RESOLVABLE).toBe(0);
    expect(r.counts.ORPHAN_NO_EDITION).toBe(1);
    expectCardinality(r);
  });

  it("key desambigua entre varias ediciones candidatas → RESOLVABLE", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 5004, publisher: "Ivrea Argentina", volumes: [1] });
    await seedCatalog({ anilistId: 5004, publisher: "Panini Argentina", volumes: [1] });
    await seedLegacy(u, { anilistId: 5004, key: "ivrea", volumes: [1] });

    const r = await scanFor(u);
    expect(r.counts.RESOLVABLE).toBe(1);
    expect(r.counts.AMBIGUOUS).toBe(0);
    expectCardinality(r);
  });

  it("key incompatible con la editorial del catálogo → EDITION_KEY_MISMATCH", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 5005, publisher: "Panini Argentina", volumes: [1] });
    await seedLegacy(u, { anilistId: 5005, key: "ivrea", volumes: [1] });

    const r = await scanFor(u);
    expect(r.counts.EDITION_KEY_MISMATCH).toBe(1);
    expect(r.counts.RESOLVABLE).toBe(0);
    expectCardinality(r);
  });

  it("sin edición en el catálogo → ORPHAN_NO_EDITION", async () => {
    const u = await mkUser();
    await seedLegacy(u, { anilistId: 5006, key: "ivrea", volumes: [1] });

    const r = await scanFor(u);
    expect(r.counts.ORPHAN_NO_EDITION).toBe(1);
    expectCardinality(r);
  });

  it("edición presente pero falta la fila Volume → ORPHAN_NO_VOLUME (mezcla con resoluble)", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 5007, publisher: "Ivrea Argentina", volumes: [1] }); // sólo Volume 1
    await seedLegacy(u, { anilistId: 5007, key: "ivrea", volumes: [1, 2] }); // posee 1 y 2

    const r = await scanFor(u);
    expect(r.counts.RESOLVABLE).toBe(1); // tomo 1
    expect(r.counts.ORPHAN_NO_VOLUME).toBe(1); // tomo 2
    expect(r.total).toBe(2);
    expectCardinality(r);
  });

  it("colisión de tripla (2 ediciones misma key + Volume) → AMBIGUOUS", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 5008, publisher: "Ivrea Argentina", volumes: [1] });
    await seedCatalog({ anilistId: 5008, publisher: "Ivrea Argentina", volumes: [1] }); // misma key + mismo número
    await seedLegacy(u, { anilistId: 5008, key: "ivrea", volumes: [1] });

    const r = await scanFor(u);
    expect(r.counts.AMBIGUOUS).toBe(1);
    expect(r.counts.RESOLVABLE).toBe(0);
    expectCardinality(r);
  });

  it("varios volúmenes de una misma edición se clasifican independientemente", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 5010, publisher: "Ivrea Argentina", volumes: [1, 2, 3] });
    await seedLegacy(u, { anilistId: 5010, key: "ivrea", volumes: [1, 2, 3] });

    const r = await scanFor(u);
    expect(r.counts.RESOLVABLE).toBe(3);
    expect(r.total).toBe(3);
    expectCardinality(r);
  });

  it("aislamiento por usuario: el mismo tomo en dos usuarios NO es ambiguo (se escanea por usuario)", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await seedCatalog({ anilistId: 5009, publisher: "Ivrea Argentina", volumes: [1] });
    await seedLegacy(a, { anilistId: 5009, key: "ivrea", volumes: [1] });
    await seedLegacy(b, { anilistId: 5009, key: "ivrea", volumes: [1] });

    const ra = await scanFor(a);
    const rb = await scanFor(b);
    expect(ra.counts.RESOLVABLE).toBe(1);
    expect(rb.counts.RESOLVABLE).toBe(1);
    expect(ra.counts.AMBIGUOUS).toBe(0);
    expect(rb.counts.AMBIGUOUS).toBe(0);
  });

  it("agregado poblacional: invariante de cardinalidad Σbuckets == total sobre una mezcla de todos los buckets", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 6001, publisher: "Ivrea Argentina", volumes: [1] }); // resoluble
    await seedCatalog({ anilistId: 6002, publisher: "Ivrea Argentina", volumes: [1] }); // falta volumen (posee 2)
    await seedCatalog({ anilistId: 6003, publisher: "Panini Argentina", volumes: [1] }); // key mismatch
    await seedCatalog({ anilistId: 6004, publisher: "Ivrea Argentina", volumes: [1] });
    await seedCatalog({ anilistId: 6004, publisher: "Ivrea Argentina", volumes: [1] }); // colisión → ambiguous
    await seedLegacy(u, { anilistId: 6001, key: "ivrea", volumes: [1] }); // RESOLVABLE
    await seedLegacy(u, { anilistId: 6002, key: "ivrea", volumes: [2] }); // ORPHAN_NO_VOLUME
    await seedLegacy(u, { anilistId: 6003, key: "ivrea", volumes: [1] }); // EDITION_KEY_MISMATCH
    await seedLegacy(u, { anilistId: 6004, key: "ivrea", volumes: [1] }); // AMBIGUOUS
    await seedLegacy(u, { anilistId: 6005, key: "ivrea", volumes: [1] }); // ORPHAN_NO_EDITION

    const agg = emptyAggregate();
    accumulate(agg, await scanFor(u));

    expect(agg.total).toBe(5);
    expect(agg.affectedUsers).toBe(1);
    expect(agg.usersWithUnresolvable).toBe(1);
    expect(agg.counts).toEqual({
      RESOLVABLE: 1,
      AMBIGUOUS: 1,
      ORPHAN_NO_EDITION: 1,
      EDITION_KEY_MISMATCH: 1,
      ORPHAN_NO_VOLUME: 1,
    });
    expect(bucketSum(agg)).toBe(agg.total);
    expect(() => assertCardinality(agg)).not.toThrow();

    // Reporte determinístico + sin PII (ejemplos = coordenadas de catálogo; nunca userId/email).
    const report = formatReport(agg, 0);
    expect(report).toContain("== total: true");
    expect(report).not.toMatch(/@bfscan\.dev|userId|email/);
    console.log("\n[F2 PR-1] Reporte de muestra contra fixtures:\n" + report);
  });

  it("idempotencia sobre el mismo snapshot: dos corridas dan resultados idénticos y NO escriben", async () => {
    const u = await mkUser();
    await seedCatalog({ anilistId: 7001, publisher: "Ivrea Argentina", volumes: [1, 2] });
    await seedLegacy(u, { anilistId: 7001, key: "ivrea", volumes: [1, 2] });
    await seedLegacy(u, { anilistId: 7002, key: "ivrea", volumes: [1] }); // huérfano sin edición

    const before = {
      owned: await prisma.ownedVolume.count(),
      positions: await prisma.ownershipPosition.count(),
      acquisitions: await prisma.acquisition.count(),
      volumes: await prisma.volume.count(),
    };

    const r1 = await scanFor(u);
    const r2 = await scanFor(u);
    expect(r2).toEqual(r1); // determinístico sobre el mismo snapshot

    const after = {
      owned: await prisma.ownedVolume.count(),
      positions: await prisma.ownershipPosition.count(),
      acquisitions: await prisma.acquisition.count(),
      volumes: await prisma.volume.count(),
    };
    expect(after).toEqual(before); // READ-ONLY: ninguna tabla cambió
  });
});
