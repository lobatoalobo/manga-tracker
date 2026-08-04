/**
 * Integración — read-side unificado de `/collection` (Retail Pilot, Fase 1) contra Postgres REAL desechable
 * (skip sin `IDENTITY_TEST_DATABASE_URL`). Cubre la estrategia de hidratación aditiva del diseño:
 *   1. Equivalencia: usuario solo legado → `getCollectionItemsUnified` == `getCollectionItems`.
 *   2. Collection-only visible: `OwnershipPosition` de un `volumeId` sin legado → aparece 1 ítem nuevo hidratado.
 *   3. Matched sin duplicado: mismo tomo en legado y Collection → aparece una sola vez.
 *   4. Tomo nuevo sobre edición legada existente: se agrega el número a esa edición (sin edición extra).
 *   5. Ambiguo: colisión de tripla en Collection → no se hidrata; la vista legada no se altera; no rompe.
 *   6. Metadata hidratada: título/autor/portada/totalVolumes salen del catálogo.
 *
 * `getCollectionItemsUnified` usa el `prisma` global (`@/lib/prisma`); el runner (`scripts/identity-it.mjs`) apunta
 * `DATABASE_URL` a la MISMA base efímera, así que el setup usa ese mismo client global.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCollectionItems, type CollectionItem } from "@/lib/collection";
import { getCollectionItemsUnified } from "@/lib/collectionUnified";
import { publisherKey } from "@/lib/publisher-key";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — read-side unificado de colección (Fase 1, base real)", () => {
  let seq = 0;
  const uniq = () => `uni-${Date.now()}-${seq++}`;

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@uni.dev`, name: "U" }, select: { id: true } })).id;

  /** Tomo poseído en el LEGADO: coordenada `(Manga.anilistId, TrackedEdition.key, OwnedVolume.volume)`. */
  async function legacyOwn(
    userId: string,
    o: { anilistId: number; key: string; volume: number; totalVolumes?: number },
  ): Promise<void> {
    const manga = await prisma.manga.upsert({
      where: { userId_anilistId: { userId, anilistId: o.anilistId } },
      update: {},
      create: { userId, anilistId: o.anilistId, romajiTitle: uniq(), coverImage: "" },
      select: { id: true },
    });
    const ed = await prisma.trackedEdition.upsert({
      where: { mangaId_key: { mangaId: manga.id, key: o.key } },
      update: {},
      create: { mangaId: manga.id, key: o.key, label: o.key, totalVolumes: o.totalVolumes ?? 10 },
      select: { id: true },
    });
    await prisma.ownedVolume.create({ data: { editionId: ed.id, volume: o.volume } });
  }

  /** Crea un `Volume` de catálogo (Work + PublisherEdition + Volume) y devuelve su `volumeId`. */
  async function mkCatalogVolume(o: {
    anilistId: number | null;
    publisher: string;
    number: number;
    volumes?: number;
    work?: { title: string; author?: string; coverImage?: string; titleEn?: string; titleNative?: string };
    coverImage?: string;
  }): Promise<number> {
    let workId: number | null = null;
    if (o.work) {
      const w = await prisma.work.create({
        data: {
          title: o.work.title,
          normTitle: `uni-${o.work.title.toLowerCase()}-${seq++}`,
          author: o.work.author ?? null,
          coverImage: o.work.coverImage ?? null,
          titleEn: o.work.titleEn ?? null,
          titleNative: o.work.titleNative ?? null,
        },
        select: { id: true },
      });
      workId = w.id;
    }
    const ed = await prisma.publisherEdition.create({
      data: {
        publisher: o.publisher,
        slug: uniq(),
        title: o.work?.title ?? "Edición",
        normTitle: `uni-${seq++}`,
        anilistId: o.anilistId,
        workId,
        volumes: o.volumes ?? 10,
        url: "uni-test",
      },
      select: { id: true },
    });
    const v = await prisma.volume.create({
      data: { editionId: ed.id, number: o.number, coverImage: o.coverImage ?? null },
      select: { id: true },
    });
    return v.id;
  }

  const holdPosition = (userId: string, volumeId: number, quantity = 1) =>
    prisma.ownershipPosition.create({ data: { userId, volumeId, quantity } });

  type Sem = { anilistId: number; key: string; volumes: number[] };
  const semOf = (items: CollectionItem[]): Sem[] =>
    items
      .map((i) => ({ anilistId: i.anilistId, key: i.edition.key, volumes: [...i.edition.ownedVolumes].sort((a, b) => a - b) }))
      .sort((a, b) => a.anilistId - b.anilistId || a.key.localeCompare(b.key));

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterEach(async () => {
    // Borrar usuarios cascada Manga/TrackedEdition/OwnedVolume/OwnershipPosition; luego el catálogo marcado.
    await prisma.user.deleteMany({ where: { email: { contains: "@uni.dev" } } });
    await prisma.publisherEdition.deleteMany({ where: { url: "uni-test" } }); // cascada a Volume
    await prisma.work.deleteMany({ where: { normTitle: { startsWith: "uni-" } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. equivalencia: sin OwnershipPosition, unificada == legada (misma referencia de contenido)", async () => {
    const u = await mkUser();
    await legacyOwn(u, { anilistId: 100, key: "ivrea", volume: 1 });
    await legacyOwn(u, { anilistId: 100, key: "ivrea", volume: 2 });
    await legacyOwn(u, { anilistId: 200, key: "panini", volume: 3 });

    const legacy = await getCollectionItems(u);
    const unified = await getCollectionItemsUnified(u);
    // Equivalencia total: sin collection-only, la salida unificada es idéntica (deep) a la legada (misma forma,
    // metadata, orden). No se compara por referencia: son dos llamadas distintas a `getCollectionItems`.
    expect(unified).toEqual(legacy);
  });

  it("2. collection-only visible + 6. metadata hidratada del catálogo", async () => {
    const u = await mkUser();
    const volId = await mkCatalogVolume({
      anilistId: 500,
      publisher: "Ivrea Argentina",
      number: 4,
      volumes: 12,
      work: { title: "Serie Preventa", author: "Autora QA", coverImage: "http://cover/x.jpg", titleEn: "Preorder Series" },
    });
    await holdPosition(u, volId, 1);

    const unified = await getCollectionItemsUnified(u);
    expect(unified).toHaveLength(1);
    const item = unified[0];
    expect(item.anilistId).toBe(500);
    expect(item.edition.key).toBe(publisherKey("Ivrea Argentina")); // "ivrea"
    expect(item.edition.ownedVolumes).toEqual([4]);
    // metadata hidratada:
    expect(item.title.romaji).toBe("Serie Preventa");
    expect(item.title.english).toBe("Preorder Series");
    expect(item.author).toBe("Autora QA");
    expect(item.coverImage).toBe("http://cover/x.jpg");
    expect(item.edition.totalVolumes).toBe(12);
    expect(item.edition.label).toBe("Ivrea Argentina");
  });

  it("3. matched sin duplicado: mismo tomo en legado y Collection aparece una sola vez", async () => {
    const u = await mkUser();
    // Legado: (100, ivrea, 1)
    await legacyOwn(u, { anilistId: 100, key: "ivrea", volume: 1 });
    // Catálogo con la MISMA tripla derivada: anilistId 100 + "Ivrea Argentina" (→ key ivrea) + number 1.
    const volId = await mkCatalogVolume({
      anilistId: 100,
      publisher: "Ivrea Argentina",
      number: 1,
      work: { title: "Serie Match" },
    });
    await holdPosition(u, volId, 1);

    const unified = await getCollectionItemsUnified(u);
    // Una sola edición (100, ivrea) con el tomo 1 una sola vez — el matched está suprimido en el facade.
    expect(semOf(unified)).toEqual([{ anilistId: 100, key: "ivrea", volumes: [1] }]);
  });

  it("4. tomo nuevo sobre edición legada existente: se agrega el número, sin edición extra", async () => {
    const u = await mkUser();
    await legacyOwn(u, { anilistId: 100, key: "ivrea", volume: 1 });
    await legacyOwn(u, { anilistId: 100, key: "ivrea", volume: 2 });
    // Preventa del tomo 3 de la misma serie/edición (ausente del legado).
    const volId = await mkCatalogVolume({
      anilistId: 100,
      publisher: "Ivrea Argentina",
      number: 3,
      work: { title: "Serie Ivrea" },
    });
    await holdPosition(u, volId, 1);

    const unified = await getCollectionItemsUnified(u);
    expect(semOf(unified)).toEqual([{ anilistId: 100, key: "ivrea", volumes: [1, 2, 3] }]);
  });

  it("5. ambiguo: colisión de tripla en Collection no se hidrata ni altera la vista legada", async () => {
    const u = await mkUser();
    await legacyOwn(u, { anilistId: 300, key: "ivrea", volume: 1 });
    // Dos Volume distintos que derivan la MISMA tripla (300, ivrea, 9): colisión → ambiguous en el facade.
    const a = await mkCatalogVolume({ anilistId: 300, publisher: "Ivrea Argentina", number: 9, work: { title: "Amb A" } });
    const b = await mkCatalogVolume({ anilistId: 300, publisher: "Ivrea Argentina", number: 9, work: { title: "Amb B" } });
    await holdPosition(u, a, 1);
    await holdPosition(u, b, 1);

    const unified = await getCollectionItemsUnified(u);
    // No se agrega el tomo 9 (ambiguo, conservador); la edición legada queda intacta con solo el tomo 1.
    expect(semOf(unified)).toEqual([{ anilistId: 300, key: "ivrea", volumes: [1] }]);
  });

  it("aislamiento entre usuarios: los collection-only de uno no aparecen en otro", async () => {
    const a = await mkUser();
    const b = await mkUser();
    const volA = await mkCatalogVolume({ anilistId: 700, publisher: "Panini Argentina", number: 2, work: { title: "Solo A" } });
    await holdPosition(a, volA, 1);
    await legacyOwn(b, { anilistId: 800, key: "ivrea", volume: 5 });

    expect(semOf(await getCollectionItemsUnified(a))).toEqual([{ anilistId: 700, key: "panini", volumes: [2] }]);
    expect(semOf(await getCollectionItemsUnified(b))).toEqual([{ anilistId: 800, key: "ivrea", volumes: [5] }]);
  });
});
