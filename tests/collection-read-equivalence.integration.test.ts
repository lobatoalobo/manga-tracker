/**
 * Integración — equivalencia del read-side unificado con la lectura legada actual (ADR-011, Slice 9 / Checkpoint 5)
 * contra Postgres REAL desechable (skip sin `IDENTITY_TEST_DATABASE_URL`).
 *
 * Con Collection VACÍO (sin OwnershipPosition), la salida de la fachada debe ser equivalente a la de
 * `getCollectionItems`. La comparación es de una **proyección semántica** común (identidad serie/edición/número +
 * posesión + orden contractual), NO de detalles accidentales del DTO legado (portadas, autor, upcoming, títulos).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOwnershipReader } from "@/lib/collection-read/facade";
import { collectionOwnershipSource } from "@/lib/collection-read/adapters/collection";
import { legacyOwnershipSource } from "@/lib/collection-read/adapters/legacy";
import { getCollectionItems } from "@/lib/collection";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

type Sem = { seriesKey: number | null; editionKey: string; number: number; owned: boolean };
const cmp = (a: Sem, b: Sem) =>
  (a.seriesKey ?? 0) - (b.seriesKey ?? 0) || a.editionKey.localeCompare(b.editionKey) || a.number - b.number;

describe.skipIf(!URL)("integración — equivalencia con la lectura legada (Slice 9, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const reader = createOwnershipReader({
    collection: collectionOwnershipSource(prisma),
    legacy: legacyOwnershipSource(prisma),
  });
  let seq = 0;
  const uniq = () => `eq-${Date.now()}-${seq++}`;

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@eq.dev`, name: "E" }, select: { id: true } })).id;

  async function own(userId: string, o: { anilistId: number; key: string; volume: number }): Promise<void> {
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
    await prisma.ownedVolume.create({ data: { editionId: ed.id, volume: o.volume } });
  }

  /** Proyección semántica de la lectura legada actual (getCollectionItems). */
  async function legacyProjection(userId: string): Promise<Sem[]> {
    const items = await getCollectionItems(userId);
    const out: Sem[] = [];
    for (const it of items)
      for (const vol of it.edition.ownedVolumes)
        out.push({ seriesKey: it.anilistId, editionKey: it.edition.key, number: vol, owned: true });
    return out.sort(cmp);
  }
  /** Proyección semántica de la fachada nueva. */
  async function facadeProjection(userId: string): Promise<Sem[]> {
    const view = await reader.getUserOwnership(userId);
    return view.items
      .map((i) => ({ seriesKey: i.seriesKey, editionKey: i.editionKey ?? "", number: i.number, owned: i.owned }))
      .sort(cmp);
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterEach(async () => {
    await prisma.ownedVolume.deleteMany({});
    await prisma.trackedEdition.deleteMany({});
    await prisma.manga.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@eq.dev" } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Collection vacío: la fachada es semánticamente equivalente al legado (varias series/ediciones/tomos)", async () => {
    const u = await mkUser();
    await own(u, { anilistId: 100, key: "ivrea", volume: 1 });
    await own(u, { anilistId: 100, key: "ivrea", volume: 2 });
    await own(u, { anilistId: 100, key: "panini", volume: 1 }); // otra edición de la misma serie
    await own(u, { anilistId: 200, key: "ivrea", volume: 3 });
    await own(u, { anilistId: -88, key: "kemuri", volume: 1 }); // obra local (-workId)

    const legacy = await legacyProjection(u);
    const facade = await facadeProjection(u);
    expect(facade).toEqual(legacy);
    expect(facade).toHaveLength(5);
  });

  it("Collection vacío: usuario sin colección → ambos vacíos", async () => {
    const u = await mkUser();
    expect(await facadeProjection(u)).toEqual([]);
    expect(await legacyProjection(u)).toEqual([]);
  });

  it("aislamiento: la equivalencia se mantiene con otro usuario cargado", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await own(a, { anilistId: 100, key: "ivrea", volume: 1 });
    await own(b, { anilistId: 999, key: "ivrea", volume: 7 });
    expect(await facadeProjection(a)).toEqual(await legacyProjection(a));
    expect(await facadeProjection(a)).toHaveLength(1);
  });
});
