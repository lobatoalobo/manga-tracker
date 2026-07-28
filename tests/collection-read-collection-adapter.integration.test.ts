/**
 * Integración — adapter Collection del read-side (ADR-011, Slice 9 / Checkpoint 3) contra Postgres REAL desechable
 * (skip sin `IDENTITY_TEST_DATABASE_URL`). Verifica: observación completa y atómica vía UNA consulta relacional
 * (OwnershipPosition→Volume→PublisherEdition), `quantity = 0` NO filtrado, anclas null pasadas fieles, publisher
 * crudo (sin derivar key), aislamiento por usuario, orden determinista por volumeId, y vacío → [].
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { collectionOwnershipSource } from "@/lib/collection-read/adapters/collection";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — adapter Collection (Slice 9, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const source = collectionOwnershipSource(prisma);
  let seq = 0;
  const uniq = () => `ca-${Date.now()}-${seq++}`;

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@ca.dev`, name: "A" }, select: { id: true } })).id;

  async function mkVolume(o: { publisher?: string; anilistId?: number | null; linkWork?: boolean; number?: number } = {}) {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({
      data: {
        publisher: o.publisher ?? "Ivrea Argentina",
        slug: t,
        title: t,
        normTitle: t,
        volumes: 10,
        url: "",
        workId: o.linkWork === false ? null : w.id,
        anilistId: o.anilistId ?? null,
      },
      select: { id: true },
    });
    const v = await prisma.volume.create({ data: { editionId: e.id, number: o.number ?? 1 }, select: { id: true } });
    return { volumeId: v.id, workId: w.id };
  }
  const mkPos = (userId: string, volumeId: number, quantity: number) =>
    prisma.ownershipPosition.create({ data: { userId, volumeId, quantity } });

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterEach(async () => {
    await prisma.ownershipPosition.deleteMany({});
    await prisma.volume.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@ca.dev" } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("produce una CollectionObservation completa y atómica (una consulta relacional, fiel a persistencia)", async () => {
    const u = await mkUser();
    const { volumeId, workId } = await mkVolume({ publisher: "Ivrea Argentina", anilistId: 30002, number: 5 });
    await mkPos(u, volumeId, 2);

    expect(await source.observe(u)).toEqual([
      { volumeId, quantity: 2, number: 5, anilistId: 30002, workId, publisher: "Ivrea Argentina" },
    ]);
  });

  it("NO filtra posiciones con quantity = 0 (Collection debe ejercer autoridad)", async () => {
    const u = await mkUser();
    const { volumeId } = await mkVolume({ anilistId: 30002 });
    await mkPos(u, volumeId, 0);

    const obs = await source.observe(u);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ volumeId, quantity: 0 });
  });

  it("pasa anclas null fieles (obra sin AniList ni workId) — no las trata como rotas", async () => {
    const u = await mkUser();
    const { volumeId } = await mkVolume({ anilistId: null, linkWork: false });
    await mkPos(u, volumeId, 1);

    expect(await source.observe(u)).toEqual([
      { volumeId, quantity: 1, number: 1, anilistId: null, workId: null, publisher: "Ivrea Argentina" },
    ]);
  });

  it("pasa el publisher tal cual (sin derivar ninguna key de correspondencia)", async () => {
    const u = await mkUser();
    const { volumeId } = await mkVolume({ publisher: "Editorial Desconocida", anilistId: 7 });
    await mkPos(u, volumeId, 1);

    const obs = await source.observe(u);
    expect(obs[0].publisher).toBe("Editorial Desconocida"); // no "ar", no key: la derivación NO ocurre acá
    expect(obs[0]).not.toHaveProperty("editionKey");
    expect(obs[0]).not.toHaveProperty("key");
  });

  it("aísla por usuario (no filtra posiciones de otro)", async () => {
    const a = await mkUser();
    const b = await mkUser();
    const { volumeId: v1 } = await mkVolume({ anilistId: 1 });
    const { volumeId: v2 } = await mkVolume({ anilistId: 2 });
    await mkPos(a, v1, 1);
    await mkPos(b, v2, 9);

    const obs = await source.observe(a);
    expect(obs).toHaveLength(1);
    expect(obs[0].volumeId).toBe(v1);
  });

  it("orden determinista por volumeId asc (heredado de getUserPositions)", async () => {
    const u = await mkUser();
    const { volumeId: v1 } = await mkVolume({ anilistId: 1 });
    const { volumeId: v2 } = await mkVolume({ anilistId: 2 });
    const { volumeId: v3 } = await mkVolume({ anilistId: 3 });
    await mkPos(u, v3, 1);
    await mkPos(u, v1, 1);
    await mkPos(u, v2, 1); // insertadas desordenadas

    const ids = (await source.observe(u)).map((o) => o.volumeId);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(ids).toEqual([v1, v2, v3].sort((x, y) => x - y));
  });

  it("usuario sin posiciones → []", async () => {
    expect(await source.observe(await mkUser())).toEqual([]);
  });
});
