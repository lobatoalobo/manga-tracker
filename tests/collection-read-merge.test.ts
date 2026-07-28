import { describe, it, expect } from "vitest";
import { mergeOwnership, type OwnershipUnit } from "@/lib/collection-read/merge";
import { InvalidMergeInput, MERGE_ERROR } from "@/lib/collection-read/errors";
import type {
  CorrespondenceResolution,
  CorrespondenceKey,
  LegacyTomoRef,
} from "@/lib/collection-read/mapping/correspondence";
import type { CollectionObservation } from "@/lib/collection-read/ports";

// --- helpers -------------------------------------------------------------------------------------------------
const emptyRes = (over: Partial<CorrespondenceResolution> = {}): CorrespondenceResolution => ({
  matched: [],
  collectionOnly: [],
  legacyOnly: [],
  unmappableCatalog: [],
  ambiguous: [],
  ...over,
});
const key = (o: Partial<CorrespondenceKey> = {}): CorrespondenceKey => ({
  seriesKey: 30002,
  editionKey: "ivrea",
  number: 1,
  ...o,
});
const legRef = (o: Partial<LegacyTomoRef> = {}): LegacyTomoRef => ({
  anilistId: 30002,
  editionKey: "ivrea",
  volume: 1,
  ...o,
});
const obs = (volumeId: number, quantity: number): CollectionObservation => ({
  volumeId,
  quantity,
  number: 1,
  anilistId: 30002,
  workId: null,
  publisher: "Ivrea Argentina",
});
const collectionUnits = (r: { units: OwnershipUnit[] }) => r.units.filter((u) => u.source === "collection");
const legacyUnits = (r: { units: OwnershipUnit[] }) => r.units.filter((u) => u.source === "legacy");
const catchCode = (fn: () => unknown): string => {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return e instanceof InvalidMergeInput ? e.code : "WRONG";
  }
};

// --- matched: Collection autoritativo, legado suprimido -------------------------------------------------------
describe("mergeOwnership · matched (Collection gana, legado suprimido)", () => {
  it("quantity ≥ 1 → collection owned:true; NO se emite el tomo legado", () => {
    const res = emptyRes({ matched: [{ key: key({ number: 5 }), volumeId: 4101, legacy: legRef({ volume: 5 }) }] });
    const r = mergeOwnership(res, [obs(4101, 2)]);
    expect(r.units).toEqual([
      { source: "collection", volumeId: 4101, key: key({ number: 5 }), owned: true, quantity: 2, fromAmbiguous: false },
    ]);
    expect(legacyUnits(r)).toHaveLength(0);
  });

  it("quantity = 0 → collection owned:FALSE (suprime la marca legada; afirmación válida de no posesión)", () => {
    const res = emptyRes({ matched: [{ key: key({ number: 5 }), volumeId: 4101, legacy: legRef({ volume: 5 }) }] });
    const r = mergeOwnership(res, [obs(4101, 0)]);
    expect(r.units).toEqual([
      { source: "collection", volumeId: 4101, key: key({ number: 5 }), owned: false, quantity: 0, fromAmbiguous: false },
    ]);
    expect(legacyUnits(r)).toHaveLength(0);
  });
});

// --- collectionOnly / unmappableCatalog -----------------------------------------------------------------------
describe("mergeOwnership · collectionOnly y unmappableCatalog", () => {
  it("collectionOnly refleja owned por quantity", () => {
    const res = emptyRes({ collectionOnly: [{ key: key({ number: 7 }), volumeId: 5000 }] });
    expect(mergeOwnership(res, [obs(5000, 1)]).units[0]).toMatchObject({ source: "collection", owned: true, quantity: 1 });
    expect(mergeOwnership(res, [obs(5000, 0)]).units[0]).toMatchObject({ source: "collection", owned: false, quantity: 0 });
  });

  it("unmappableCatalog → collection con key null, owned por quantity", () => {
    const res = emptyRes({ unmappableCatalog: [{ volumeId: 12030 }] });
    const r = mergeOwnership(res, [obs(12030, 3)]);
    expect(r.units).toEqual([
      { source: "collection", volumeId: 12030, key: null, owned: true, quantity: 3, fromAmbiguous: false },
    ]);
  });
});

// --- legacyOnly: backstop -------------------------------------------------------------------------------------
describe("mergeOwnership · legacyOnly (backstop)", () => {
  it("emite unidad legada owned:true, quantity 1", () => {
    const t = legRef({ anilistId: 51000, editionKey: "edicion-2020", volume: 1 });
    const r = mergeOwnership(emptyRes({ legacyOnly: [t] }), []);
    expect(r.units).toEqual([{ source: "legacy", legacy: t, owned: true, quantity: 1, fromAmbiguous: false }]);
  });
});

// --- ambiguous: independiente, sin supresión ------------------------------------------------------------------
describe("mergeOwnership · ambiguous (independiente, sin supresión)", () => {
  it("emite cada volumen de catálogo y cada tomo legado por separado, fromAmbiguous:true", () => {
    const t = legRef({ anilistId: 42, editionKey: "ar", volume: 3 });
    const res = emptyRes({
      ambiguous: [{ key: key({ seriesKey: 42, editionKey: "ar", number: 3 }), volumeIds: [700, 701], legacy: [t] }],
    });
    const r = mergeOwnership(res, [obs(700, 1), obs(701, 0)]);
    expect(collectionUnits(r)).toEqual([
      { source: "collection", volumeId: 700, key: key({ seriesKey: 42, editionKey: "ar", number: 3 }), owned: true, quantity: 1, fromAmbiguous: true },
      { source: "collection", volumeId: 701, key: key({ seriesKey: 42, editionKey: "ar", number: 3 }), owned: false, quantity: 0, fromAmbiguous: true },
    ]);
    expect(legacyUnits(r)).toEqual([{ source: "legacy", legacy: t, owned: true, quantity: 1, fromAmbiguous: true }]);
  });
});

// --- invariantes ----------------------------------------------------------------------------------------------
describe("mergeOwnership · invariantes", () => {
  const res = emptyRes({
    matched: [{ key: key({ number: 5 }), volumeId: 4101, legacy: legRef({ volume: 5 }) }],
    collectionOnly: [{ key: key({ number: 6 }), volumeId: 4102 }],
    unmappableCatalog: [{ volumeId: 12030 }],
    legacyOnly: [legRef({ anilistId: 51000, editionKey: "edicion-2020", volume: 1 })],
    ambiguous: [{ key: key({ seriesKey: 42, editionKey: "ar", number: 3 }), volumeIds: [700, 701], legacy: [legRef({ anilistId: 42, editionKey: "ar", volume: 3 })] }],
  });
  const collection = [obs(4101, 2), obs(4102, 1), obs(12030, 3), obs(700, 1), obs(701, 0)];
  const r = mergeOwnership(res, collection);

  it("cobertura: |collection units| = matched + collectionOnly + unmappable + ambiguous-catalog", () => {
    expect(collectionUnits(r)).toHaveLength(1 + 1 + 1 + 2);
  });

  it("cobertura: |legacy units| = legacyOnly + ambiguous-legacy (los matched NO se emiten)", () => {
    expect(legacyUnits(r)).toHaveLength(1 + 1);
  });

  it("soundness de supresión: el tomo legado de un matched nunca aparece como unidad legada", () => {
    const suppressed = legRef({ volume: 5 });
    expect(legacyUnits(r).some((u) => u.source === "legacy" && JSON.stringify(u.legacy) === JSON.stringify(suppressed))).toBe(false);
  });

  it("quantity proviene de la observación (lookup por volumeId)", () => {
    const u = collectionUnits(r).find((x) => x.source === "collection" && x.volumeId === 4101);
    expect(u).toMatchObject({ quantity: 2, owned: true });
  });

  it("determinismo: mismas entradas → misma salida", () => {
    const r2 = mergeOwnership(res, collection);
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r));
  });

  it("orden determinista: matched → collectionOnly → unmappable → legacyOnly → ambiguous", () => {
    expect(r.units.map((u) => (u.source === "collection" ? u.volumeId : `L${u.legacy.volume}`))).toEqual([
      4101, 4102, 12030, "L1", 700, 701, "L3",
    ]);
  });
});

// --- contrato de biyección resolución ↔ observaciones ---------------------------------------------------------
describe("mergeOwnership · contrato resolución ↔ observaciones", () => {
  it("volumeId requerido SIN observación → MISSING_OBSERVATION (nunca owned:false silencioso)", () => {
    const res = emptyRes({ collectionOnly: [{ key: key(), volumeId: 999 }] });
    expect(() => mergeOwnership(res, [])).toThrow(InvalidMergeInput);
    expect(catchCode(() => mergeOwnership(res, []))).toBe(MERGE_ERROR.MISSING_OBSERVATION);
  });

  it("observaciones DUPLICADAS para el mismo volumeId → DUPLICATE_OBSERVATION", () => {
    const res = emptyRes({ collectionOnly: [{ key: key(), volumeId: 700 }] });
    expect(catchCode(() => mergeOwnership(res, [obs(700, 1), obs(700, 2)]))).toBe(MERGE_ERROR.DUPLICATE_OBSERVATION);
  });

  it("observación SOBRANTE que no aparece en la resolución → EXTRANEOUS_OBSERVATION", () => {
    const res = emptyRes({ collectionOnly: [{ key: key(), volumeId: 700 }] });
    expect(catchCode(() => mergeOwnership(res, [obs(700, 1), obs(999, 1)]))).toBe(MERGE_ERROR.EXTRANEOUS_OBSERVATION);
  });

  it("quantity < 0 → NEGATIVE_QUANTITY (aunque la persistencia lo garantice)", () => {
    const res = emptyRes({ collectionOnly: [{ key: key(), volumeId: 700 }] });
    expect(catchCode(() => mergeOwnership(res, [obs(700, -1)]))).toBe(MERGE_ERROR.NEGATIVE_QUANTITY);
  });

  it("el fallo crítico (matched sin observación) LANZA, no oculta el legado con owned:false", () => {
    // resolution.matched=42 + legado poseído; la observación de 42 falta por un bug de carga.
    const res = emptyRes({ matched: [{ key: key(), volumeId: 42, legacy: legRef() }] });
    expect(() => mergeOwnership(res, [])).toThrow(InvalidMergeInput);
    // Ninguna categoría produjo una unidad: no hay resultado parcial.
    expect(catchCode(() => mergeOwnership(res, []))).toBe(MERGE_ERROR.MISSING_OBSERVATION);
  });

  it("la biyección exacta (mismos volumeId en ambos lados) NO lanza", () => {
    const res = emptyRes({ collectionOnly: [{ key: key(), volumeId: 700 }] });
    expect(() => mergeOwnership(res, [obs(700, 1)])).not.toThrow();
  });
});
