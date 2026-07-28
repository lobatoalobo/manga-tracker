import { describe, it, expect } from "vitest";
import { buildCorrespondenceIndex, resolveCorrespondence } from "@/lib/collection-read/mapping/correspondence";
import { mergeOwnership } from "@/lib/collection-read/merge";
import { buildReconciliationReport, type ReconciliationReport } from "@/lib/collection-read/reconciliation";
import { createOwnershipReader } from "@/lib/collection-read/facade";
import type { CollectionObservation, LegacyObservation, OwnershipSource } from "@/lib/collection-read/ports";

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

function report(collection: CollectionObservation[], legacy: LegacyObservation[]): ReconciliationReport<LegacyObservation> {
  const resolution = resolveCorrespondence(buildCorrespondenceIndex(collection, legacy));
  const result = mergeOwnership(resolution, collection);
  return buildReconciliationReport(resolution, result);
}

// ---------------------------------------------------------------------------
// buildReconciliationReport (puro)
// ---------------------------------------------------------------------------
describe("buildReconciliationReport · conteos por categoría", () => {
  it("cuenta matched / collectionOnly / legacyOnly / unmappableCatalog / ambiguous", () => {
    const r = report(
      [
        cobs({ volumeId: 4101, number: 5, quantity: 2 }), // matched (con legado v5)
        cobs({ volumeId: 4102, number: 6, quantity: 1 }), // collectionOnly
        cobs({ volumeId: 9000, anilistId: null, workId: null, number: 2, quantity: 1 }), // unmappableCatalog
        cobs({ volumeId: 700, anilistId: 42, publisher: "Editorial X", number: 3, quantity: 1 }), // ambiguous
        cobs({ volumeId: 701, anilistId: 42, publisher: "Editorial Y", number: 3, quantity: 1 }), // ambiguous
      ],
      [
        lobs({ ownedVolumeId: 111, volume: 5 }), // matched
        lobs({ ownedVolumeId: 222, editionKey: "edicion-2020", volume: 1 }), // legacyOnly
        lobs({ ownedVolumeId: 900, anilistId: 42, editionKey: "ar", volume: 3 }), // ambiguous
      ],
    );
    expect(r.counts).toMatchObject({ matched: 1, collectionOnly: 1, legacyOnly: 1, unmappableCatalog: 1, ambiguous: 1 });
  });

  it("sin problemas → categorías problemáticas en 0", () => {
    const r = report([cobs({ volumeId: 4101, number: 5, quantity: 2 })], [lobs({ ownedVolumeId: 111, volume: 5 })]);
    expect(r.counts.collectionZeroQuantity).toBe(0);
    expect(r.counts.authorityContradictions).toBe(0);
    expect(r.ambiguities).toHaveLength(0);
  });
});

describe("buildReconciliationReport · quantity=0 y contradicciones de autoridad", () => {
  it("cuenta e identifica posiciones Collection con quantity = 0", () => {
    const r = report([cobs({ volumeId: 4102, number: 6, quantity: 0 })], []); // collectionOnly q=0
    expect(r.counts.collectionZeroQuantity).toBe(1);
    expect(r.collectionZeroQuantity).toEqual([{ volumeId: 4102 }]);
    expect(r.counts.authorityContradictions).toBe(0); // no es matched
  });

  it("identifica la contradicción de autoridad (matched q=0 suprime un tomo legado poseído)", () => {
    const r = report(
      [cobs({ volumeId: 4101, number: 5, quantity: 0 })],
      [lobs({ ownedVolumeId: 111, volume: 5 })],
    );
    expect(r.counts.authorityContradictions).toBe(1);
    expect(r.authorityContradictions).toHaveLength(1);
    expect(r.authorityContradictions[0].volumeId).toBe(4101);
    expect(r.authorityContradictions[0].legacy.ownedVolumeId).toBe(111); // identidad legada conservada, sin cast
    // también aparece en el conteo general de quantity=0
    expect(r.counts.collectionZeroQuantity).toBe(1);
  });
});

describe("buildReconciliationReport · identidades conservadas", () => {
  it("ambigüedades conservan volumeIds y ownedVolumeIds", () => {
    const r = report(
      [
        cobs({ volumeId: 700, anilistId: 42, publisher: "Editorial X", number: 3, quantity: 1 }),
        cobs({ volumeId: 701, anilistId: 42, publisher: "Editorial Y", number: 3, quantity: 1 }),
      ],
      [lobs({ ownedVolumeId: 900, anilistId: 42, editionKey: "ar", volume: 3 })],
    );
    expect(r.ambiguities).toHaveLength(1);
    expect(r.ambiguities[0].volumeIds).toEqual([700, 701]);
    expect(r.ambiguities[0].legacy.map((x) => x.ownedVolumeId)).toEqual([900]);
  });

  it("unmappableCatalog conserva los volumeId", () => {
    const r = report([cobs({ volumeId: 9000, anilistId: null, workId: null, quantity: 1 })], []);
    expect(r.unmappableCatalog).toEqual([{ volumeId: 9000 }]);
  });
});

// ---------------------------------------------------------------------------
// Integración con la fachada (sink)
// ---------------------------------------------------------------------------
const src = <T>(items: T[]): OwnershipSource<T> => ({ observe: async () => items });

describe("facade · sink de reconciliación", () => {
  it("publica el reporte en el sink inyectado", async () => {
    let captured: ReconciliationReport<LegacyObservation> | null = null;
    const reader = createOwnershipReader({
      collection: src([cobs({ volumeId: 4101, number: 5, quantity: 0 })]),
      legacy: src([lobs({ ownedVolumeId: 111, volume: 5 })]),
      reconciliationSink: (r) => { captured = r; },
    });
    await reader.getUserOwnership("u");
    expect(captured).not.toBeNull();
    expect(captured!.counts.authorityContradictions).toBe(1);
  });

  it("la salida es idéntica con y sin sink (la reconciliación no altera el resultado)", async () => {
    const collection = [cobs({ volumeId: 4101, number: 5, quantity: 2 })];
    const legacy = [lobs({ ownedVolumeId: 7, volume: 9 })];
    const withoutSink = await createOwnershipReader({ collection: src(collection), legacy: src(legacy) }).getUserOwnership("u");
    const withSink = await createOwnershipReader({
      collection: src(collection),
      legacy: src(legacy),
      reconciliationSink: () => {},
    }).getUserOwnership("u");
    expect(JSON.stringify(withSink)).toBe(JSON.stringify(withoutSink));
  });

  it("un sink SÍNCRONO que lanza NO rompe la lectura (best-effort); la salida se conserva", async () => {
    const reader = createOwnershipReader({
      collection: src([cobs({ volumeId: 4101, number: 5, quantity: 2 })]),
      legacy: src([]),
      reconciliationSink: () => { throw new Error("sink boom"); },
    });
    const v = await reader.getUserOwnership("u");
    expect(v.items).toHaveLength(1);
    expect(v.items[0].id).toBe("collection:4101");
  });

  it("un sink ASÍNCRONO que rechaza NO rompe la lectura (el rechazo queda aislado, no unhandled)", async () => {
    const reader = createOwnershipReader({
      collection: src([cobs({ volumeId: 4101, number: 5, quantity: 2 })]),
      legacy: src([]),
      reconciliationSink: async () => { throw new Error("async sink boom"); },
    });
    const v = await reader.getUserOwnership("u");
    expect(v.items).toHaveLength(1);
    expect(v.items[0].id).toBe("collection:4101");
  });

  it("la fachada ESPERA (await) al sink asíncrono antes de devolver la vista", async () => {
    const order: string[] = [];
    const reader = createOwnershipReader({
      collection: src([cobs({ volumeId: 4101, number: 5, quantity: 2 })]),
      legacy: src([]),
      reconciliationSink: async () => {
        await Promise.resolve();
        order.push("sink");
      },
    });
    await reader.getUserOwnership("u");
    order.push("after");
    // Si el sink no fuera esperado, "after" se registraría antes de "sink".
    expect(order).toEqual(["sink", "after"]);
  });

  it("la salida es idéntica con sink exitoso, sink fallido o sink ausente", async () => {
    const collection = [cobs({ volumeId: 4101, number: 5, quantity: 2 })];
    const legacy = [lobs({ ownedVolumeId: 7, volume: 9 })];
    const base = () => ({ collection: src(collection), legacy: src(legacy) });
    const absent = await createOwnershipReader(base()).getUserOwnership("u");
    const ok = await createOwnershipReader({ ...base(), reconciliationSink: async () => {} }).getUserOwnership("u");
    const failing = await createOwnershipReader({
      ...base(),
      reconciliationSink: async () => { throw new Error("boom"); },
    }).getUserOwnership("u");
    expect(JSON.stringify(ok)).toBe(JSON.stringify(absent));
    expect(JSON.stringify(failing)).toBe(JSON.stringify(absent));
  });

  it("un error PREVIO del adapter propaga fail-fast y NO es capturado como fallo de observabilidad", async () => {
    let sinkCalled = false;
    const failingLegacy: OwnershipSource<LegacyObservation> = {
      observe: async () => { throw new Error("adapter down"); },
    };
    const reader = createOwnershipReader({
      collection: src([cobs({ volumeId: 4101, number: 5, quantity: 2 })]),
      legacy: failingLegacy,
      reconciliationSink: () => { sinkCalled = true; },
    });
    await expect(reader.getUserOwnership("u")).rejects.toThrow("adapter down");
    expect(sinkCalled).toBe(false); // el fail-fast ocurre antes de la observabilidad
  });
});
