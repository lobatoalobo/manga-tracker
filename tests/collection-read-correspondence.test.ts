import { describe, it, expect } from "vitest";
import {
  deriveCatalogKey,
  deriveLegacyKey,
  buildCorrespondenceIndex,
  resolveCorrespondence,
  type CatalogVolumeRef,
  type LegacyTomoRef,
} from "@/lib/collection-read/mapping/correspondence";

// Base Ivrea tomo 1; se sobreescriben campos por test.
const cat = (o: Partial<CatalogVolumeRef> = {}): CatalogVolumeRef => ({
  volumeId: 1,
  number: 1,
  anilistId: 30002,
  workId: null,
  publisher: "Ivrea Argentina",
  ...o,
});
const leg = (o: Partial<LegacyTomoRef> = {}): LegacyTomoRef => ({
  anilistId: 30002,
  editionKey: "ivrea",
  volume: 1,
  ...o,
});

// ---------------------------------------------------------------------------
// deriveCatalogKey / deriveLegacyKey
// ---------------------------------------------------------------------------
describe("deriveCatalogKey", () => {
  it("obra AniList: usa anilistId + publisherKey + number", () => {
    expect(deriveCatalogKey(cat({ number: 5, publisher: "Ivrea Argentina" }))).toEqual({
      seriesKey: 30002,
      editionKey: "ivrea",
      number: 5,
    });
  });

  it("obra local: anilistId null + workId → seriesKey = -workId", () => {
    expect(deriveCatalogKey(cat({ anilistId: null, workId: 88, number: 3, publisher: "Kemuri Ediciones" }))).toEqual({
      seriesKey: -88,
      editionKey: "kemuri",
      number: 3,
    });
  });

  it("editorial internacional VIZ → key 'viz'", () => {
    expect(deriveCatalogKey(cat({ publisher: "VIZ Media", number: 12 }))!.editionKey).toBe("viz");
  });

  it("editorial fuera del mapa → key 'ar'", () => {
    expect(deriveCatalogKey(cat({ publisher: "Editorial Nueva X" }))!.editionKey).toBe("ar");
  });

  it("sin ancla de serie (anilistId null y workId null) → null (UNMAPPABLE)", () => {
    expect(deriveCatalogKey(cat({ anilistId: null, workId: null }))).toBeNull();
  });

  it("anilistId 0 es inválido: cae a workId, o null si no hay", () => {
    expect(deriveCatalogKey(cat({ anilistId: 0, workId: 88, publisher: "Kemuri Ediciones" }))!.seriesKey).toBe(-88);
    expect(deriveCatalogKey(cat({ anilistId: 0, workId: null }))).toBeNull();
  });
});

describe("deriveLegacyKey", () => {
  it("usa la coordenada legada tal cual (anilistId puede ser -workId)", () => {
    expect(deriveLegacyKey(leg({ anilistId: -88, editionKey: "kemuri", volume: 3 }))).toEqual({
      seriesKey: -88,
      editionKey: "kemuri",
      number: 3,
    });
  });
});

describe("simetría de derivación (misma tripla para un par correspondiente)", () => {
  it("catálogo Ivrea y legado 'ivrea' del mismo tomo producen la misma clave", () => {
    const c = deriveCatalogKey(cat({ number: 5 }))!;
    const l = deriveLegacyKey(leg({ volume: 5 }));
    expect(c).toEqual(l);
  });
  it("obra local: catálogo (-workId via workId) y legado (-workId directo) coinciden", () => {
    const c = deriveCatalogKey(cat({ anilistId: null, workId: 88, publisher: "Kemuri Ediciones", number: 3 }))!;
    const l = deriveLegacyKey(leg({ anilistId: -88, editionKey: "kemuri", volume: 3 }));
    expect(c).toEqual(l);
  });
});

// ---------------------------------------------------------------------------
// resolveCorrespondence — clasificación exhaustiva y disjunta
// ---------------------------------------------------------------------------
describe("resolveCorrespondence", () => {
  it("MATCHED: tomo presente en ambos ejes (unívoca)", () => {
    const idx = buildCorrespondenceIndex([cat({ volumeId: 4101, number: 5 })], [leg({ volume: 5 })]);
    const r = resolveCorrespondence(idx);
    expect(r.matched).toEqual([
      { key: { seriesKey: 30002, editionKey: "ivrea", number: 5 }, volumeId: 4101, legacy: leg({ volume: 5 }) },
    ]);
    expect(r.collectionOnly).toHaveLength(0);
    expect(r.legacyOnly).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(0);
  });

  it("MATCHED obra local por -workId", () => {
    const idx = buildCorrespondenceIndex(
      [cat({ volumeId: 9007, anilistId: null, workId: 88, publisher: "Kemuri Ediciones", number: 3 })],
      [leg({ anilistId: -88, editionKey: "kemuri", volume: 3 })],
    );
    const r = resolveCorrespondence(idx);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].volumeId).toBe(9007);
  });

  it("COLLECTION_ONLY: posición sin par legado", () => {
    const r = resolveCorrespondence(buildCorrespondenceIndex([cat({ volumeId: 4101, number: 5 })], []));
    expect(r.collectionOnly).toEqual([{ key: { seriesKey: 30002, editionKey: "ivrea", number: 5 }, volumeId: 4101 }]);
    expect(r.matched).toHaveLength(0);
  });

  it("LEGACY_ONLY: tomo legado con key custom sin correspondencia (backstop)", () => {
    const t = leg({ anilistId: 51000, editionKey: "edicion-especial-2020", volume: 1 });
    const r = resolveCorrespondence(buildCorrespondenceIndex([], [t]));
    expect(r.legacyOnly).toEqual([t]);
    expect(r.matched).toHaveLength(0);
  });

  it("LEGACY_ONLY: número distinto no matchea (se sirve por separado)", () => {
    const r = resolveCorrespondence(
      buildCorrespondenceIndex([cat({ volumeId: 4101, number: 5 })], [leg({ volume: 6 })]),
    );
    expect(r.matched).toHaveLength(0);
    expect(r.collectionOnly).toHaveLength(1);
    expect(r.legacyOnly).toHaveLength(1);
  });

  it("UNMAPPABLE_CATALOG: posición sin ancla de serie", () => {
    const r = resolveCorrespondence(
      buildCorrespondenceIndex([cat({ volumeId: 12030, anilistId: null, workId: null })], []),
    );
    expect(r.unmappableCatalog).toEqual([{ volumeId: 12030 }]);
    expect(r.matched).toHaveLength(0);
    expect(r.collectionOnly).toHaveLength(0);
  });

  it("AMBIGUOUS: dos editoriales fuera del mapa colapsan a 'ar' → colisión, no se adivina", () => {
    const a = cat({ volumeId: 700, number: 3, anilistId: 42, publisher: "Editorial Nueva X" });
    const b = cat({ volumeId: 701, number: 3, anilistId: 42, publisher: "Editorial Nueva Y" });
    const t = leg({ anilistId: 42, editionKey: "ar", volume: 3 });
    const r = resolveCorrespondence(buildCorrespondenceIndex([a, b], [t]));
    expect(r.matched).toHaveLength(0);
    expect(r.ambiguous).toEqual([
      { key: { seriesKey: 42, editionKey: "ar", number: 3 }, volumeIds: [700, 701], legacy: [t] },
    ]);
  });

  it("AMBIGUOUS también sin legado (colisión de catálogo pura)", () => {
    const a = cat({ volumeId: 700, number: 3, anilistId: 42, publisher: "Editorial Nueva X" });
    const b = cat({ volumeId: 701, number: 3, anilistId: 42, publisher: "Editorial Nueva Y" });
    const r = resolveCorrespondence(buildCorrespondenceIndex([a, b], []));
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].legacy).toHaveLength(0);
    expect(r.collectionOnly).toHaveLength(0);
  });

  it("AMBIGUOUS del lado legado: dos tomos legados colapsan en la misma tripla (colisión legada)", () => {
    // Sintético: dos TrackedEdition distintas que derivan la misma tripla (mismo eje serie + key + número). No se
    // asume legacy.length ≤ 1: los @@unique garantizan la identidad PERSISTIDA, no la tripla DERIVADA.
    const t1 = leg({ anilistId: 99, editionKey: "ivrea", volume: 2 });
    const t2 = leg({ anilistId: 99, editionKey: "ivrea", volume: 2 });
    const r = resolveCorrespondence(buildCorrespondenceIndex([], [t1, t2]));
    expect(r.matched).toHaveLength(0);
    expect(r.legacyOnly).toHaveLength(0);
    expect(r.ambiguous).toEqual([
      { key: { seriesKey: 99, editionKey: "ivrea", number: 2 }, volumeIds: [], legacy: [t1, t2] },
    ]);
  });

  it("colisión legada NUNCA se resuelve a matched aunque el catálogo sea único (no se elige legacy[0])", () => {
    const c = cat({ volumeId: 5000, anilistId: 99, publisher: "Ivrea Argentina", number: 2 });
    const t1 = leg({ anilistId: 99, editionKey: "ivrea", volume: 2 });
    const t2 = leg({ anilistId: 99, editionKey: "ivrea", volume: 2 });
    const r = resolveCorrespondence(buildCorrespondenceIndex([c], [t1, t2]));
    expect(r.matched).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].volumeIds).toEqual([5000]);
    expect(r.ambiguous[0].legacy).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// keyString: inequívoca para cualquier editionKey (no depende de un delimitador)
// ---------------------------------------------------------------------------
describe("keyString (serialización de la tripla)", () => {
  it("distingue editionKeys con comillas/comas (triplas distintas no colisionan)", () => {
    const a = leg({ anilistId: 7, editionKey: 'x", 9, "y', volume: 1 });
    const b = leg({ anilistId: 7, editionKey: "x", volume: 1 });
    const r = resolveCorrespondence(buildCorrespondenceIndex([], [a, b]));
    expect(r.legacyOnly).toHaveLength(2);
    expect(r.ambiguous).toHaveLength(0);
  });

  it("agrupa triplas idénticas aunque la editionKey sea inusual (espacios)", () => {
    const a = leg({ anilistId: 7, editionKey: "a b c", volume: 1 });
    const b = leg({ anilistId: 7, editionKey: "a b c", volume: 1 });
    const r = resolveCorrespondence(buildCorrespondenceIndex([], [a, b]));
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].legacy).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Invariantes
// ---------------------------------------------------------------------------
describe("invariantes", () => {
  const catalog = [
    cat({ volumeId: 4101, number: 5 }), // matched
    cat({ volumeId: 4102, number: 6 }), // collectionOnly
    cat({ volumeId: 9007, anilistId: null, workId: 88, publisher: "Kemuri Ediciones", number: 3 }), // matched local
    cat({ volumeId: 12030, anilistId: null, workId: null }), // unmappable
    cat({ volumeId: 700, number: 3, anilistId: 42, publisher: "Editorial Nueva X" }), // ambiguous
    cat({ volumeId: 701, number: 3, anilistId: 42, publisher: "Editorial Nueva Y" }), // ambiguous
  ];
  const legacy = [
    leg({ volume: 5 }), // matched con 4101
    leg({ anilistId: -88, editionKey: "kemuri", volume: 3 }), // matched con 9007
    leg({ anilistId: 51000, editionKey: "edicion-especial-2020", volume: 1 }), // legacyOnly
    leg({ anilistId: 42, editionKey: "ar", volume: 3 }), // ambiguous
  ];
  const r = resolveCorrespondence(buildCorrespondenceIndex(catalog, legacy));

  it("totalidad y disjunción del lado catálogo (cada volumeId en exactamente una categoría)", () => {
    const seen = [
      ...r.matched.map((m) => m.volumeId),
      ...r.collectionOnly.map((c) => c.volumeId),
      ...r.unmappableCatalog.map((u) => u.volumeId),
      ...r.ambiguous.flatMap((a) => a.volumeIds),
    ];
    expect(seen.sort()).toEqual([700, 701, 4101, 4102, 9007, 12030].sort());
    expect(new Set(seen).size).toBe(seen.length); // sin duplicados
  });

  it("totalidad y disjunción del lado legado (cada tomo en exactamente una categoría)", () => {
    const seen = [
      ...r.matched.map((m) => m.legacy),
      ...r.legacyOnly,
      ...r.ambiguous.flatMap((a) => a.legacy),
    ];
    expect(seen).toHaveLength(legacy.length);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("inyectividad de matched (1:1) y soundness de supresión (solo matched se suprime)", () => {
    const volIds = r.matched.map((m) => m.volumeId);
    expect(new Set(volIds).size).toBe(volIds.length);
    // Un tomo legado se suprime SOLO si está en matched: los ambiguos/legacyOnly no.
    const suppressed = r.matched.map((m) => m.legacy);
    expect(suppressed).toHaveLength(2);
    expect(suppressed).not.toContainEqual(leg({ anilistId: 42, editionKey: "ar", volume: 3 }));
  });

  it("ambiguo nunca aparece en matched", () => {
    expect(r.matched.some((m) => m.volumeId === 700 || m.volumeId === 701)).toBe(false);
  });

  it("determinismo: mismas entradas → misma salida", () => {
    const r2 = resolveCorrespondence(buildCorrespondenceIndex(catalog, legacy));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r));
  });
});
