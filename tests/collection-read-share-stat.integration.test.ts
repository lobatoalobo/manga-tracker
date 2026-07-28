/**
 * Integración del primer consumidor migrado del read-side unificado (ADR-011, Slice 9 / Checkpoint 7): el stat
 * "Tomos poseídos" de la Share pública (`app/u/[slug]` → `getPublicCollection`). Contra Postgres REAL desechable
 * (skip sin `IDENTITY_TEST_DATABASE_URL`). Verifica:
 *  - Semántica del conteo: posiciones con `owned === true`, UNA vez por posición (NO Σ ejemplares).
 *  - Equivalencia estricta con el legado cuando todo es resoluble (AniList, `-workId`, varias ediciones, aislamiento).
 *  - Autoridad de Collection (Opción D): `quantity = 0` suprime un tomo legado poseído → divergencia ESPERADA.
 *  - Ambigüedad: se respeta la política de `mergeOwnership` (sin dedup silenciosa); el reporte conserva identidades.
 *  - La metadata/grilla siguen viniendo del camino legado; el contrato de `getPublicCollection` se conserva.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildOwnershipReader } from "@/lib/collection-read/root";
import { ownedItems } from "@/lib/collection-read/facade";
import { getPublicCollection } from "@/lib/collection";
import { getCollectionStats, progressPercentage } from "@/services/collectionService";
import type { ReconciliationReport } from "@/lib/collection-read/reconciliation";
import type { LegacyObservation } from "@/lib/collection-read/ports";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — CP7: stat 'Tomos poseídos' de la Share pública", () => {
  let seq = 0;
  const uniq = () => `cr7-${Date.now()}-${seq++}`;

  const mkUser = async (shareSlug?: string) =>
    (await prisma.user.create({ data: { email: `${uniq()}@cr7.dev`, name: "R", shareSlug }, select: { id: true } })).id;

  /** Siembra una posición de Collection (crea PublisherEdition + Volume + OwnershipPosition). `anchor` = ancla de serie. */
  async function mkCatalogPosition(
    userId: string,
    anchor: { anilistId?: number | null; workId?: number | null },
    publisher: string,
    number: number,
    quantity: number,
  ): Promise<number> {
    const t = uniq();
    const edition = await prisma.publisherEdition.create({
      data: {
        publisher,
        slug: t,
        title: t,
        normTitle: t,
        volumes: 100,
        url: "",
        anilistId: anchor.anilistId ?? null,
        workId: anchor.workId ?? null,
      },
      select: { id: true },
    });
    const vol = await prisma.volume.create({ data: { editionId: edition.id, number }, select: { id: true } });
    await prisma.ownershipPosition.create({ data: { userId, volumeId: vol.id, quantity } });
    return vol.id;
  }

  /** Crea un Work local (para el eje `-workId`) y devuelve su id. */
  const mkWork = async () => {
    const t = uniq();
    return (await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } })).id;
  };

  /** Siembra un tomo poseído legado (Manga → TrackedEdition → OwnedVolume). Devuelve `ownedVolumeId`. */
  async function mkLegacyOwned(
    userId: string,
    anilistId: number,
    key: string,
    volume: number,
    totalVolumes = 100,
  ): Promise<number> {
    const manga = await prisma.manga.upsert({
      where: { userId_anilistId: { userId, anilistId } },
      update: {},
      create: { userId, anilistId, romajiTitle: `title-${anilistId}`, coverImage: `cover-${anilistId}` },
      select: { id: true },
    });
    const edition = await prisma.trackedEdition.upsert({
      where: { mangaId_key: { mangaId: manga.id, key } },
      update: {},
      create: { mangaId: manga.id, key, label: key, totalVolumes },
      select: { id: true },
    });
    return (await prisma.ownedVolume.create({ data: { editionId: edition.id, volume }, select: { id: true } })).id;
  }

  /** Conteo LEGADO puro: filas de `OwnedVolume` del usuario (lo que sumaba `getCollectionItems`). */
  const legacyCount = (userId: string) =>
    prisma.ownedVolume.count({ where: { edition: { manga: { userId } } } });

  /** Conteo NUEVO vía read-side unificado. `sink` opcional captura el reporte de reconciliación. */
  async function unifiedCount(
    userId: string,
    sink?: (r: ReconciliationReport<LegacyObservation>) => void,
  ): Promise<number> {
    const reader = buildOwnershipReader(prisma, sink);
    return ownedItems(await reader.getUserOwnership(userId)).length;
  }

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.ownershipPosition.deleteMany({});
    await prisma.acquisition.deleteMany({});
    await prisma.ownedVolume.deleteMany({});
    await prisma.trackedEdition.deleteMany({});
    await prisma.manga.deleteMany({});
    await prisma.volume.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@cr7.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- Equivalencia estricta (datos completamente resolubles) ----------------------------------------------
  describe("equivalencia estricta con el legado", () => {
    it("1) Collection vacío → stat nuevo igual al legado (todo cae al backstop legado)", async () => {
      const u = await mkUser();
      await mkLegacyOwned(u, 30002, "ivrea", 1);
      await mkLegacyOwned(u, 30002, "ivrea", 2);
      await mkLegacyOwned(u, 30002, "ivrea", 3);
      expect(await unifiedCount(u)).toBe(await legacyCount(u));
      expect(await unifiedCount(u)).toBe(3);
    });

    it("2) obra AniList con match unívoco → igual al legado", async () => {
      const u = await mkUser();
      await mkLegacyOwned(u, 30002, "ivrea", 1);
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 1, 1);
      expect(await unifiedCount(u)).toBe(1);
      expect(await unifiedCount(u)).toBe(await legacyCount(u));
    });

    it("3) obra local con -workId y match unívoco → igual al legado", async () => {
      const u = await mkUser();
      const w = await mkWork();
      await mkLegacyOwned(u, -w, "ivrea", 1);
      await mkCatalogPosition(u, { workId: w }, "Ivrea Argentina", 1, 1);
      expect(await unifiedCount(u)).toBe(1);
      expect(await unifiedCount(u)).toBe(await legacyCount(u));
    });

    it("4) varias ediciones de la misma serie, todas resolubles → igual al legado", async () => {
      const u = await mkUser();
      // Edición Ivrea (v1, v2) + edición Panini (v1), todas con match.
      await mkLegacyOwned(u, 40000, "ivrea", 1);
      await mkLegacyOwned(u, 40000, "ivrea", 2);
      await mkLegacyOwned(u, 40000, "panini", 1);
      await mkCatalogPosition(u, { anilistId: 40000 }, "Ivrea Argentina", 1, 1);
      await mkCatalogPosition(u, { anilistId: 40000 }, "Ivrea Argentina", 2, 1);
      await mkCatalogPosition(u, { anilistId: 40000 }, "Panini Argentina", 1, 1);
      expect(await unifiedCount(u)).toBe(3);
      expect(await unifiedCount(u)).toBe(await legacyCount(u));
    });

    it("5) aislamiento entre usuarios: el stat de A no incluye datos de B", async () => {
      const a = await mkUser();
      const b = await mkUser();
      await mkLegacyOwned(a, 30002, "ivrea", 1);
      await mkLegacyOwned(a, 30002, "ivrea", 2);
      for (let v = 1; v <= 5; v++) await mkLegacyOwned(b, 99999, "ivrea", v);
      expect(await unifiedCount(a)).toBe(2);
      expect(await unifiedCount(b)).toBe(5);
    });
  });

  // --- Semántica del conteo (posición, no ejemplares) ------------------------------------------------------
  describe("semántica del conteo", () => {
    it("6) quantity = 0 NO cuenta (afirmación autoritativa de no posesión)", async () => {
      const u = await mkUser();
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 1, 0); // collectionOnly q=0
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 2, 1); // collectionOnly q=1
      expect(await unifiedCount(u)).toBe(1); // solo la q=1
    });

    it("7) quantity > 1 cuenta UNA sola posición (NO Σ ejemplares) — guarda contra sum(quantity)", async () => {
      const u = await mkUser();
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 1, 3);
      const count = await unifiedCount(u);
      expect(count).toBe(1); // una posición poseída, no 3
      expect(count).not.toBe(3); // explícito: no es sum(quantity)
    });
  });

  // --- Autoridad de Collection (Opción D): divergencia ESPERADA --------------------------------------------
  describe("autoridad de Collection", () => {
    it("8) match con quantity = 0 suprime el tomo legado poseído → nuevo < legado (divergencia esperada)", async () => {
      const u = await mkUser();
      const ownedVolumeId = await mkLegacyOwned(u, 30002, "ivrea", 5);
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 5, 0); // matched q=0

      let report: ReconciliationReport<LegacyObservation> | null = null;
      const nuevo = await unifiedCount(u, (r) => { report = r; });

      expect(nuevo).toBe(0); // Collection autoritativo: no posee
      expect(await legacyCount(u)).toBe(1); // el legado aislado SÍ lo contaría
      // La divergencia es una aplicación de Opción D, registrada por la reconciliación con identidad conservada.
      expect(report!.counts.authorityContradictions).toBe(1);
      expect(report!.authorityContradictions[0].volumeId).toBeGreaterThan(0);
      expect(report!.authorityContradictions[0].legacy.ownedVolumeId).toBe(ownedVolumeId);
    });
  });

  // --- Ambigüedad: política de merge, sin dedup silenciosa -------------------------------------------------
  describe("ambigüedad", () => {
    it("9) colisión de tripla → sigue la política de mergeOwnership, sin deduplicar para igualar el legado", async () => {
      const u = await mkUser();
      // Dos volúmenes de catálogo que derivan la MISMA tripla (42, "ar", 3): dos editoriales que caen al fallback
      // "ar" + mismo número + misma serie. Más un tomo legado en la misma tripla.
      const vX = await mkCatalogPosition(u, { anilistId: 42 }, "Editorial X", 3, 1);
      const vY = await mkCatalogPosition(u, { anilistId: 42 }, "Editorial Y", 3, 1);
      const ownedVolumeId = await mkLegacyOwned(u, 42, "ar", 3);

      let report: ReconciliationReport<LegacyObservation> | null = null;
      const reader = buildOwnershipReader(prisma, (r) => { report = r; });
      const view = await reader.getUserOwnership(u);
      const owned = ownedItems(view);

      // Política de merge: el grupo ambiguo se sirve TODO independiente (2 unidades de Collection + 1 legada),
      // sin supresión ni fusión. El entero NO se colapsa a 1 sólo para igualar al legado.
      expect(owned).toHaveLength(3);
      expect(await legacyCount(u)).toBe(1); // el legado aislado contaría 1
      // Identidades distintas conservadas (sin dedup).
      const ids = owned.map((i) => i.id).sort();
      expect(ids).toEqual([`collection:${vX}`, `collection:${vY}`, `legacy:${ownedVolumeId}`].sort());
      // Todas marcadas como ambiguas.
      expect(owned.every((i) => i.ambiguous)).toBe(true);
      // El reporte contiene el grupo ambiguo con sus identidades.
      expect(report!.counts.ambiguous).toBe(1);
      expect(report!.ambiguities[0].volumeIds.sort((a, b) => a - b)).toEqual([vX, vY].sort((a, b) => a - b));
      expect(report!.ambiguities[0].legacy.map((l) => l.ownedVolumeId)).toEqual([ownedVolumeId]);
    });
  });

  // --- Camino legado intacto + contrato de la fachada de lectura -------------------------------------------
  describe("metadata legada + contrato de getPublicCollection", () => {
    it("10) metadata y grilla siguen viniendo del camino legado; ownedVolumes = conteo unificado", async () => {
      const slug = uniq();
      const u = await mkUser(slug);
      await mkLegacyOwned(u, 30002, "ivrea", 1);
      await mkLegacyOwned(u, 30002, "ivrea", 2);
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 1, 1); // match v1
      // v2 queda legacyOnly (sin posición) → sigue contando

      const data = (await getPublicCollection(slug))!;
      expect(data).not.toBeNull();
      // Metadata legada intacta (títulos/portada/edición/ownedVolumes) — NO proviene del read-side.
      expect(data.items).toHaveLength(1);
      expect(data.items[0].title.romaji).toBe("title-30002");
      expect(data.items[0].coverImage).toBe("cover-30002");
      expect(data.items[0].edition.key).toBe("ivrea");
      expect([...data.items[0].edition.ownedVolumes].sort((a, b) => a - b)).toEqual([1, 2]);
      // Stat "Tomos poseídos" = conteo unificado (match v1 + legacyOnly v2 = 2).
      expect(data.ownedVolumes).toBe(2);
      expect(data.ownedVolumes).toBe(await unifiedCount(u));
    });

    it("11) contrato de getPublicCollection conservado (forma + null en slug inexistente)", async () => {
      expect(await getPublicCollection(`no-existe-${uniq()}`)).toBeNull();

      const slug = uniq();
      const u = await mkUser(slug);
      await mkLegacyOwned(u, 30002, "ivrea", 1);
      const data = (await getPublicCollection(slug))!;
      expect(Object.keys(data).sort()).toEqual(["favoriteId", "items", "name", "ownedVolumes"].sort());
      expect(typeof data.name).toBe("string");
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.ownedVolumes).toBe("number");
    });
  });

  // --- Consistencia stat ↔ porcentaje (como los cablea la página: mismo numerador unificado) ----------------
  describe("consistencia stat ↔ porcentaje", () => {
    it("A) equivalencia: stat y porcentaje comparten el numerador unificado", async () => {
      const slug = uniq();
      const u = await mkUser(slug);
      // Edición legada totalVolumes=10; 2 matches unívocos poseídos.
      await mkLegacyOwned(u, 30002, "ivrea", 1, 10);
      await mkLegacyOwned(u, 30002, "ivrea", 2, 10);
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 1, 1);
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 2, 1);

      const data = (await getPublicCollection(slug))!;
      const stats = getCollectionStats(data.items);
      const percentage = progressPercentage(data.ownedVolumes, stats.totalVolumes);
      expect(data.ownedVolumes).toBe(2);
      expect(stats.totalVolumes).toBe(10);
      expect(percentage).toBe(20); // round(2/10*100) sobre el MISMO numerador del stat
    });

    it("B) autoridad de Collection: stat 0 y porcentaje 0 (legado contaría 1)", async () => {
      const slug = uniq();
      const u = await mkUser(slug);
      await mkLegacyOwned(u, 30002, "ivrea", 5, 10); // legado poseído
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 5, 0); // matched q=0 (suprime)

      const data = (await getPublicCollection(slug))!;
      const stats = getCollectionStats(data.items);
      const percentage = progressPercentage(data.ownedVolumes, stats.totalVolumes);
      expect(await legacyCount(u)).toBe(1); // el legado aislado contaría 1
      expect(data.ownedVolumes).toBe(0); // stat visible 0
      expect(percentage).toBe(0); // barra 0, coherente con el stat
    });

    it("C) ambigüedad: stat conserva el resultado del merge; porcentaje clampa a 100 (nunca lo supera)", async () => {
      const slug = uniq();
      const u = await mkUser(slug);
      // Edición legada con totalVolumes=1 para forzar ownedVolumes(3) > totalVolumes(1).
      await mkLegacyOwned(u, 42, "ar", 3, 1);
      await mkCatalogPosition(u, { anilistId: 42 }, "Editorial X", 3, 1);
      await mkCatalogPosition(u, { anilistId: 42 }, "Editorial Y", 3, 1);

      const data = (await getPublicCollection(slug))!;
      const stats = getCollectionStats(data.items);
      const percentage = progressPercentage(data.ownedVolumes, stats.totalVolumes);
      expect(data.ownedVolumes).toBe(3); // conteo REAL conservado (política de merge, sin dedup ni clamp)
      expect(stats.totalVolumes).toBe(1);
      expect(percentage).toBe(100); // clamp de presentación
      expect(percentage).toBeLessThanOrEqual(100); // nunca supera 100
    });

    it("D) totalVolumes = 0 (sin edición legada) → porcentaje 0 sin división por cero; ownedVolumes conservado", async () => {
      const slug = uniq();
      const u = await mkUser(slug);
      // Solo posición de Collection, sin Manga legado ⇒ items=[] ⇒ totalVolumes=0.
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 1, 1);

      const data = (await getPublicCollection(slug))!;
      const stats = getCollectionStats(data.items);
      const percentage = progressPercentage(data.ownedVolumes, stats.totalVolumes);
      expect(stats.totalVolumes).toBe(0);
      expect(data.ownedVolumes).toBe(1); // el poseído real se conserva
      expect(percentage).toBe(0);
      expect(Number.isFinite(percentage)).toBe(true);
    });

    it("E) metadata, stat y barra derivan del MISMO ownedVolumes unificado", async () => {
      const slug = uniq();
      const u = await mkUser(slug);
      await mkLegacyOwned(u, 30002, "ivrea", 5, 10); // legado poseído
      await mkCatalogPosition(u, { anilistId: 30002 }, "Ivrea Argentina", 5, 0); // suprime ⇒ ownedVolumes=0

      const data = (await getPublicCollection(slug))!;
      const stats = getCollectionStats(data.items);
      // Los tres consumidores de la página leen data.ownedVolumes (único numerador):
      const metadataNumber = data.ownedVolumes; // generateMetadata: `${stats.series} series y ${data.ownedVolumes} tomos`
      const statNumerator = data.ownedVolumes; // stat "Tomos": `${data.ownedVolumes} / ${stats.totalVolumes}`
      const barPercentage = progressPercentage(data.ownedVolumes, stats.totalVolumes); // barra
      expect(metadataNumber).toBe(0);
      expect(statNumerator).toBe(0);
      expect(barPercentage).toBe(0);
      // Coherencia: si el stat es 0, la barra es 0 (no hay derivación legada divergente).
      expect(statNumerator).toBe(metadataNumber);
    });
  });
});
