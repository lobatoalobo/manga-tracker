import { describe, it, expect } from "vitest";
import { createOwnershipReader, ownedItems, type OwnershipView } from "@/lib/collection-read/facade";
import type { CollectionObservation, LegacyObservation, OwnershipSource } from "@/lib/collection-read/ports";

// Fuentes stub (sin DB): la fachada es Prisma-free y sólo depende de los OwnershipSource inyectados.
const src = <T>(items: T[]): OwnershipSource<T> => ({ observe: async () => items });
const reader = (collection: CollectionObservation[], legacy: LegacyObservation[]) =>
  createOwnershipReader({ collection: src(collection), legacy: src(legacy) });

const cobs = (o: Partial<CollectionObservation> & { volumeId: number }): CollectionObservation => ({
  number: 1,
  anilistId: 30002,
  workId: null,
  publisher: "Ivrea Argentina",
  quantity: 1,
  ...o,
});
const lobs = (o: Partial<LegacyObservation> & { ownedVolumeId: number }): LegacyObservation => ({
  anilistId: 30002,
  editionKey: "ivrea",
  volume: 1,
  ...o,
});
const ids = (v: OwnershipView) => v.items.map((i) => i.id);

describe("facade · Collection vacío → sólo legado", () => {
  it("emite un item legado por tomo, con id persistido y campos fieles", async () => {
    const v = await reader([], [lobs({ ownedVolumeId: 111, editionKey: "ivrea", volume: 5 })]).getUserOwnership("u");
    expect(v.items).toEqual([
      { id: "legacy:111", source: "legacy", owned: true, quantity: 1, seriesKey: 30002, editionKey: "ivrea", number: 5, ambiguous: false },
    ]);
  });
});

describe("facade · autoridad de Collection y owned:false", () => {
  it("matched: emite Collection, suprime el legado", async () => {
    const v = await reader(
      [cobs({ volumeId: 4101, number: 5, quantity: 2 })],
      [lobs({ ownedVolumeId: 111, volume: 5 })],
    ).getUserOwnership("u");
    expect(v.items).toEqual([
      { id: "collection:4101", source: "collection", owned: true, quantity: 2, seriesKey: 30002, editionKey: "ivrea", number: 5, ambiguous: false },
    ]);
  });

  it("quantity = 0 se conserva como owned:false (NO se filtra en el core)", async () => {
    const v = await reader([cobs({ volumeId: 4101, number: 5, quantity: 0 })], []).getUserOwnership("u");
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ id: "collection:4101", owned: false, quantity: 0 });
  });

  it("ownedItems() es la proyección EXPLÍCITA solo-poseídos", async () => {
    const v = await reader(
      [cobs({ volumeId: 4101, number: 5, quantity: 0 }), cobs({ volumeId: 4102, number: 6, quantity: 1 })],
      [],
    ).getUserOwnership("u");
    expect(v.items).toHaveLength(2); // el core no filtra
    expect(ownedItems(v).map((i) => i.id)).toEqual(["collection:4102"]); // proyección explícita
  });
});

describe("facade · unmappableCatalog", () => {
  it("posición sin ancla → seriesKey/editionKey null, presente (no oculto)", async () => {
    const v = await reader([cobs({ volumeId: 9000, anilistId: null, workId: null, number: 2, quantity: 1 })], []).getUserOwnership("u");
    expect(v.items).toEqual([
      { id: "collection:9000", source: "collection", owned: true, quantity: 1, seriesKey: null, editionKey: null, number: 2, ambiguous: false },
    ]);
  });
});

describe("facade · ambigüedad", () => {
  it("expone ambiguous:true y mantiene ids distintos por identidad persistida", async () => {
    // Dos volúmenes de catálogo que colapsan a (42,"ar",3) + un tomo legado de la misma tripla.
    const v = await reader(
      [
        cobs({ volumeId: 700, anilistId: 42, publisher: "Editorial X", number: 3, quantity: 1 }),
        cobs({ volumeId: 701, anilistId: 42, publisher: "Editorial Y", number: 3, quantity: 1 }),
      ],
      [lobs({ ownedVolumeId: 900, anilistId: 42, editionKey: "ar", volume: 3 })],
    ).getUserOwnership("u");
    expect(v.items.every((i) => i.ambiguous)).toBe(true);
    expect(new Set(ids(v)).size).toBe(3); // ids distintos: no colisionan pese a la tripla común
    expect(ids(v)).toEqual(expect.arrayContaining(["collection:700", "collection:701", "legacy:900"]));
  });
});

describe("facade · orden contractual determinista", () => {
  it("ordena por serie → edición → tomo, independiente del orden de entrada", async () => {
    const v = await reader(
      [],
      [
        lobs({ ownedVolumeId: 3, anilistId: 200, editionKey: "ivrea", volume: 1 }),
        lobs({ ownedVolumeId: 1, anilistId: 100, editionKey: "panini", volume: 2 }),
        lobs({ ownedVolumeId: 2, anilistId: 100, editionKey: "panini", volume: 1 }),
      ],
    ).getUserOwnership("u");
    expect(v.items.map((i) => [i.seriesKey, i.editionKey, i.number])).toEqual([
      [100, "panini", 1],
      [100, "panini", 2],
      [200, "ivrea", 1],
    ]);
  });

  it("determinismo: mismas entradas → misma salida", async () => {
    const r = reader([cobs({ volumeId: 4101, number: 5, quantity: 2 })], [lobs({ ownedVolumeId: 7, volume: 9 })]);
    const a = await r.getUserOwnership("u");
    const b = await r.getUserOwnership("u");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
