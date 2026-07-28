/**
 * Integración — adapter legado del read-side (ADR-011, Slice 9 / Checkpoint 4) contra Postgres REAL desechable
 * (skip sin `IDENTITY_TEST_DATABASE_URL`). Verifica: sólo tomos poseídos, identidad completa (anilistId/-workId,
 * TrackedEdition.key, OwnedVolume.volume) + `ownedVolumeId` estable, sin dedup (una observación por fila),
 * pasaje fiel de valores, aislamiento por usuario, orden determinista por ownedVolumeId, vacío → [].
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { legacyOwnershipSource } from "@/lib/collection-read/adapters/legacy";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — adapter legado (Slice 9, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const source = legacyOwnershipSource(prisma);
  let seq = 0;
  const uniq = () => `la-${Date.now()}-${seq++}`;

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@la.dev`, name: "L" }, select: { id: true } })).id;

  /** Marca un tomo como poseído (crea Manga+TrackedEdition si faltan). Devuelve el ownedVolumeId. */
  async function own(userId: string, o: { anilistId: number; key: string; volume: number }): Promise<number> {
    const manga = await prisma.manga.upsert({
      where: { userId_anilistId: { userId, anilistId: o.anilistId } },
      update: {},
      create: { userId, anilistId: o.anilistId, romajiTitle: uniq(), coverImage: "" },
      select: { id: true },
    });
    const ed = await prisma.trackedEdition.upsert({
      where: { mangaId_key: { mangaId: manga.id, key: o.key } },
      update: {},
      create: { mangaId: manga.id, key: o.key, label: o.key, totalVolumes: 10 },
      select: { id: true },
    });
    const ov = await prisma.ownedVolume.create({ data: { editionId: ed.id, volume: o.volume }, select: { id: true } });
    return ov.id;
  }
  /** Crea una edición trackeada SIN tomos poseídos (para verificar que no aparece). */
  async function trackWithoutOwning(userId: string, o: { anilistId: number; key: string }): Promise<void> {
    const manga = await prisma.manga.upsert({
      where: { userId_anilistId: { userId, anilistId: o.anilistId } },
      update: {},
      create: { userId, anilistId: o.anilistId, romajiTitle: uniq(), coverImage: "" },
      select: { id: true },
    });
    await prisma.trackedEdition.upsert({
      where: { mangaId_key: { mangaId: manga.id, key: o.key } },
      update: {},
      create: { mangaId: manga.id, key: o.key, label: o.key, totalVolumes: 10 },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterEach(async () => {
    await prisma.ownedVolume.deleteMany({});
    await prisma.trackedEdition.deleteMany({});
    await prisma.manga.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@la.dev" } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("produce una LegacyObservation completa con ownedVolumeId estable", async () => {
    const u = await mkUser();
    const ovId = await own(u, { anilistId: 30002, key: "ivrea", volume: 5 });

    expect(await source.observe(u)).toEqual([
      { ownedVolumeId: ovId, anilistId: 30002, editionKey: "ivrea", volume: 5 },
    ]);
  });

  it("devuelve SÓLO tomos poseídos (una edición trackeada sin OwnedVolume no aparece)", async () => {
    const u = await mkUser();
    await trackWithoutOwning(u, { anilistId: 30002, key: "ivrea" });
    expect(await source.observe(u)).toEqual([]);

    const ovId = await own(u, { anilistId: 30002, key: "ivrea", volume: 1 });
    const obs = await source.observe(u);
    expect(obs).toHaveLength(1);
    expect(obs[0].ownedVolumeId).toBe(ovId);
  });

  it("pasa la convención -workId (obra local) fiel: anilistId negativo tal cual", async () => {
    const u = await mkUser();
    await own(u, { anilistId: -88, key: "kemuri", volume: 3 });
    const obs = await source.observe(u);
    expect(obs[0]).toMatchObject({ anilistId: -88, editionKey: "kemuri", volume: 3 });
  });

  it("pasa valores 'sospechosos' fieles (anilistId = 0) sin filtrar: lo decide el mapping", async () => {
    const u = await mkUser();
    await own(u, { anilistId: 0, key: "ar", volume: 1 });
    const obs = await source.observe(u);
    expect(obs).toHaveLength(1);
    expect(obs[0].anilistId).toBe(0);
  });

  it("NO deduplica: una observación por fila, cada una con su ownedVolumeId", async () => {
    const u = await mkUser();
    const a = await own(u, { anilistId: 30002, key: "ivrea", volume: 1 });
    const b = await own(u, { anilistId: 30002, key: "ivrea", volume: 2 });
    const c = await own(u, { anilistId: 555, key: "panini", volume: 1 });
    const obs = await source.observe(u);
    expect(obs).toHaveLength(3);
    expect(obs.map((o) => o.ownedVolumeId).sort((x, y) => x - y)).toEqual([a, b, c].sort((x, y) => x - y));
    expect(new Set(obs.map((o) => o.ownedVolumeId)).size).toBe(3); // identidades distintas
  });

  it("aísla por usuario (no filtra tomos de otro)", async () => {
    const a = await mkUser();
    const b = await mkUser();
    const av = await own(a, { anilistId: 1, key: "ivrea", volume: 1 });
    await own(b, { anilistId: 2, key: "ivrea", volume: 1 });
    const obs = await source.observe(a);
    expect(obs).toHaveLength(1);
    expect(obs[0].ownedVolumeId).toBe(av);
  });

  it("orden determinista por ownedVolumeId asc", async () => {
    const u = await mkUser();
    // Insertar en un orden distinto al de sus ids: los ids crecen con la creación.
    const first = await own(u, { anilistId: 1, key: "ivrea", volume: 1 });
    const second = await own(u, { anilistId: 1, key: "ivrea", volume: 2 });
    const third = await own(u, { anilistId: 2, key: "panini", volume: 1 });
    const ids = (await source.observe(u)).map((o) => o.ownedVolumeId);
    expect(ids).toEqual([first, second, third]); // ya en orden de id asc
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });

  it("usuario sin tomos poseídos → []", async () => {
    expect(await source.observe(await mkUser())).toEqual([]);
  });
});
