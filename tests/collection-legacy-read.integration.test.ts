/**
 * EC-1 — Red de caracterización del camino LEGADO de lectura de colección (`getCollectionItems` / `getSeries`)
 * contra Postgres REAL desechable (skip sin `IDENTITY_TEST_DATABASE_URL`).
 *
 * OBJETIVO: fijar el contrato OBSERVABLE que F2 (backfill) y F3 (cutover de lectura) van a tocar, para poder
 * refactorizar con confianza. NO es cobertura por cobertura: cada aserción protege un campo/comportamiento del que
 * depende un consumidor real (app/collection, api/export, lib/shopping, Dashboard, services/collectionService,
 * serie/[id] vía getSeries).
 *
 * PR-1 = DTO core con enriquecimiento VACÍO (sin Work/PublisherEdition): portada = guardada, autor = null,
 * upcoming = false. El override de portada nacional / autor / upcoming se caracteriza en PR-2 (requiere seed de
 * catálogo).
 *
 * Distinción golden vs accidental (ver EC-1):
 *  - OBSERVABLE (se preserva): orden de series por romajiTitle; un ítem por edición; anilistId como clave de serie;
 *    ownedVolumes ordenados asc; passthrough de title.{romaji,english,native} y de los campos de edición
 *    consumidos (key,label,publisher,region,totalVolumes,readingStatus,readingVolume); getSeries ordena ediciones
 *    por createdAt asc.
 *  - ACCIDENTAL (NO se congela): orden intra-serie de ediciones en getCollectionItems (sin orderBy → indefinido);
 *    campo `status` ALMACENADO (ningún lector lo consume; la grilla usa el status DERIVADO de editionProgress);
 *    valor concreto de editionId (solo se asserta que es number).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getCollectionItems, getSeries } from "@/lib/collection";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("EC-1 — caracterización de la lectura legada de colección (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `ec1-${Date.now()}-${seq++}`;

  const mkUser = async () =>
    (await prisma.user.create({ data: { email: `${uniq()}@ec1.dev`, name: "EC1" }, select: { id: true } })).id;

  interface SeedEdition {
    key: string;
    label?: string;
    publisher?: string | null;
    region?: string;
    totalVolumes: number;
    readingStatus?: string;
    readingVolume?: number | null;
    owned?: number[];
    createdAt?: Date;
  }
  interface SeedSeries {
    anilistId: number;
    romajiTitle: string;
    englishTitle?: string | null;
    nativeTitle?: string | null;
    coverImage?: string;
    editions?: SeedEdition[];
  }

  async function seedSeries(userId: string, s: SeedSeries): Promise<void> {
    const manga = await prisma.manga.create({
      data: {
        userId,
        anilistId: s.anilistId,
        romajiTitle: s.romajiTitle,
        englishTitle: s.englishTitle ?? null,
        nativeTitle: s.nativeTitle ?? null,
        coverImage: s.coverImage ?? "",
      },
      select: { id: true },
    });
    for (const e of s.editions ?? []) {
      const ed = await prisma.trackedEdition.create({
        data: {
          mangaId: manga.id,
          key: e.key,
          label: e.label ?? e.key,
          publisher: e.publisher ?? null,
          region: e.region ?? "AR",
          totalVolumes: e.totalVolumes,
          readingStatus: e.readingStatus ?? "UNREAD",
          readingVolume: e.readingVolume ?? null,
          ...(e.createdAt ? { createdAt: e.createdAt } : {}),
        },
        select: { id: true },
      });
      if (e.owned?.length) {
        await prisma.ownedVolume.createMany({
          data: e.owned.map((v) => ({ editionId: ed.id, volume: v })),
        });
      }
    }
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterEach(async () => {
    // Manga/TrackedEdition/OwnedVolume caen por cascade al borrar el usuario (onDelete: Cascade).
    await prisma.user.deleteMany({ where: { email: { contains: "@ec1.dev" } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("colección vacía → []", async () => {
    const u = await mkUser();
    expect(await getCollectionItems(u)).toEqual([]);
  });

  it("una serie / una edición: mapeo del DTO y passthrough de los campos consumidos", async () => {
    const u = await mkUser();
    await seedSeries(u, {
      anilistId: 900001,
      romajiTitle: "Alpha",
      englishTitle: "Alpha EN",
      nativeTitle: "アルファ",
      coverImage: "stored-cover",
      editions: [
        {
          key: "ivrea",
          label: "Ivrea Argentina",
          publisher: "Ivrea",
          region: "AR",
          totalVolumes: 10,
          readingStatus: "READING",
          readingVolume: 4,
          owned: [3, 1, 2], // desordenado a propósito
        },
      ],
    });

    const items = await getCollectionItems(u);
    expect(items).toHaveLength(1);
    const [it] = items;

    // Campos de serie
    expect(it.anilistId).toBe(900001);
    expect(it.title).toEqual({ romaji: "Alpha", english: "Alpha EN", native: "アルファ" });
    // Enriquecimiento vacío en PR-1:
    expect(it.author).toBeNull();
    expect(it.upcoming).toBe(false);
    expect(it.coverImage).toBe("stored-cover"); // sin portada nacional → la guardada

    // Passthrough de edición (campos consumidos por export/shopping/editionProgress)
    expect(it.edition.key).toBe("ivrea");
    expect(it.edition.label).toBe("Ivrea Argentina");
    expect(it.edition.publisher).toBe("Ivrea");
    expect(it.edition.region).toBe("AR");
    expect(it.edition.totalVolumes).toBe(10);
    expect(it.edition.readingStatus).toBe("READING");
    expect(it.edition.readingVolume).toBe(4);
    // OBSERVABLE: ownedVolumes ordenados asc
    expect(it.edition.ownedVolumes).toEqual([1, 2, 3]);
    // ACCIDENTAL: editionId es un id de DB → solo tipo, no valor
    expect(typeof it.edition.editionId).toBe("number");
  });

  it("una serie con varias ediciones → un ítem por edición; campos de serie compartidos; contenido por edición (order-insensitive)", async () => {
    const u = await mkUser();
    await seedSeries(u, {
      anilistId: 900002,
      romajiTitle: "Bravo",
      coverImage: "cover-b",
      editions: [
        { key: "ivrea", totalVolumes: 5, owned: [1, 2] },
        { key: "panini", totalVolumes: 8, owned: [3] },
      ],
    });

    const items = await getCollectionItems(u);
    expect(items).toHaveLength(2); // un ítem por edición (getCollectionStats.editions = items.length)
    // Campos de serie compartidos entre las ediciones de la misma serie
    for (const it of items) {
      expect(it.anilistId).toBe(900002);
      expect(it.title.romaji).toBe("Bravo");
      expect(it.coverImage).toBe("cover-b");
    }
    // Contenido por edición — order-insensitive (el orden intra-serie es ACCIDENTAL)
    const byKey = new Map(items.map((it) => [it.edition.key, it.edition]));
    expect(byKey.get("ivrea")?.ownedVolumes).toEqual([1, 2]);
    expect(byKey.get("panini")?.ownedVolumes).toEqual([3]);
  });

  it("varias series → orden por romajiTitle asc (a nivel serie)", async () => {
    const u = await mkUser();
    // Sembradas fuera de orden alfabético a propósito; títulos distintos (sin empates DB-dependientes).
    await seedSeries(u, { anilistId: 900010, romajiTitle: "Charlie", editions: [{ key: "e", totalVolumes: 1, owned: [1] }] });
    await seedSeries(u, { anilistId: 900011, romajiTitle: "Alpha", editions: [{ key: "e", totalVolumes: 1, owned: [1] }] });
    await seedSeries(u, { anilistId: 900012, romajiTitle: "Bravo", editions: [{ key: "e", totalVolumes: 1, owned: [1] }] });

    const items = await getCollectionItems(u);
    expect(items.map((i) => i.title.romaji)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("serie sin ediciones → 0 ítems (COMPORTAMIENTO ACTUAL, no necesariamente deseado; preservar para F2)", async () => {
    const u = await mkUser();
    await seedSeries(u, { anilistId: 900020, romajiTitle: "SinEdiciones", editions: [] });
    await seedSeries(u, { anilistId: 900021, romajiTitle: "ConEdicion", editions: [{ key: "e", totalVolumes: 1, owned: [1] }] });

    const items = await getCollectionItems(u);
    // La serie sin ediciones no aporta ningún ítem (el doble for no itera sobre editions vacío).
    expect(items.map((i) => i.anilistId)).toEqual([900021]);
  });

  it("aislamiento por userId", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await seedSeries(a, { anilistId: 900030, romajiTitle: "DeA", editions: [{ key: "e", totalVolumes: 1, owned: [1] }] });
    await seedSeries(b, { anilistId: 900031, romajiTitle: "DeB", editions: [{ key: "e", totalVolumes: 1, owned: [1] }] });

    const itemsA = await getCollectionItems(a);
    expect(itemsA).toHaveLength(1);
    expect(itemsA[0].anilistId).toBe(900030);
  });

  it("anilistId negativo (obra local -workId): presente; sin enriquecimiento → autor null, upcoming false, portada guardada", async () => {
    const u = await mkUser();
    await seedSeries(u, {
      anilistId: -777,
      romajiTitle: "Local",
      coverImage: "local-cover",
      editions: [{ key: "kemuri", totalVolumes: 3, owned: [1] }],
    });

    const items = await getCollectionItems(u);
    expect(items).toHaveLength(1);
    expect(items[0].anilistId).toBe(-777);
    expect(items[0].author).toBeNull();
    expect(items[0].upcoming).toBe(false);
    expect(items[0].coverImage).toBe("local-cover");
  });

  it("nulos: englishTitle/nativeTitle null, publisher null, readingVolume null, coverImage '' → passthrough", async () => {
    const u = await mkUser();
    await seedSeries(u, {
      anilistId: 900040,
      romajiTitle: "SoloRomaji",
      englishTitle: null,
      nativeTitle: null,
      coverImage: "",
      editions: [{ key: "e", publisher: null, totalVolumes: 4, readingVolume: null, owned: [2] }],
    });

    const items = await getCollectionItems(u);
    const [it] = items;
    expect(it.title).toEqual({ romaji: "SoloRomaji", english: null, native: null });
    expect(it.coverImage).toBe(""); // sin portada nacional y guardada vacía → ""
    expect(it.edition.publisher).toBeNull();
    expect(it.edition.readingVolume).toBeNull();
  });

  it("inconsistencias permitidas por el modelo: ownedVolumes > totalVolumes se devuelven sin filtrar (ordenados); totalVolumes=0 permitido", async () => {
    const u = await mkUser();
    await seedSeries(u, {
      anilistId: 900050,
      romajiTitle: "Inconsistente",
      editions: [
        { key: "sobrepasa", totalVolumes: 5, owned: [7, 1] }, // tomo 7 > total 5 (el toggle no clampea al crear)
        { key: "sintotal", totalVolumes: 0, owned: [1] }, // total desconocido
      ],
    });

    const items = await getCollectionItems(u);
    const byKey = new Map(items.map((it) => [it.edition.key, it.edition]));
    // getCollectionItems NO filtra ni clampea: devuelve [1,7] ordenado, incluido el que supera el total.
    expect(byKey.get("sobrepasa")?.ownedVolumes).toEqual([1, 7]);
    expect(byKey.get("sintotal")?.totalVolumes).toBe(0);
    expect(byKey.get("sintotal")?.ownedVolumes).toEqual([1]);
  });

  // --- getSeries (lectura de una serie; hermana de toEditionView, con orden determinístico por createdAt) ---

  it("getSeries: serie inexistente → null", async () => {
    const u = await mkUser();
    expect(await getSeries(u, 123456)).toBeNull();
  });

  it("getSeries: ediciones ordenadas por createdAt asc (determinístico) + mapeo del DTO", async () => {
    const u = await mkUser();
    // createdAt explícito e inequívoco: 'panini' creada ANTES que 'ivrea' aunque se siembren en otro orden.
    await seedSeries(u, {
      anilistId: 900060,
      romajiTitle: "ConOrden",
      englishTitle: "With Order",
      nativeTitle: null,
      coverImage: "cover-s",
      editions: [
        { key: "ivrea", totalVolumes: 10, owned: [1], createdAt: new Date("2020-01-02T00:00:00Z") },
        { key: "panini", totalVolumes: 6, owned: [2], createdAt: new Date("2020-01-01T00:00:00Z") },
      ],
    });

    const series = await getSeries(u, 900060);
    expect(series).not.toBeNull();
    expect(series!.title).toEqual({ romaji: "ConOrden", english: "With Order", native: null });
    expect(series!.coverImage).toBe("cover-s");
    // OBSERVABLE: ediciones por createdAt asc → panini (más vieja) primero.
    expect(series!.editions.map((e) => e.key)).toEqual(["panini", "ivrea"]);
  });
});
