import { describe, it, expect } from "vitest";
import {
  buildCorrespondenceIndex,
  resolveCorrespondence,
  type CatalogVolumeRef,
} from "@/lib/collection-read/mapping/correspondence";
import { mergeOwnership } from "@/lib/collection-read/merge";
import type { CollectionObservation, LegacyObservation } from "@/lib/collection-read/ports";

// Propagación tipada de `ownedVolumeId` end-to-end (Checkpoint 4B). Con L = LegacyObservation, la identidad
// persistida se conserva en CorrespondenceIndex → CorrespondenceResolution → mergeOwnership → OwnershipResult.
// El ACCESO a `.ownedVolumeId` (sin cast) es en sí la prueba de compilación; los expect son la prueba de runtime.

const catRef = (o: Partial<CatalogVolumeRef> = {}): CatalogVolumeRef => ({
  volumeId: 1,
  number: 1,
  anilistId: 30002,
  workId: null,
  publisher: "Ivrea Argentina",
  ...o,
});
const legObs = (o: Partial<LegacyObservation> = {}): LegacyObservation => ({
  anilistId: 30002,
  editionKey: "ivrea",
  volume: 1,
  ownedVolumeId: 0,
  ...o,
});
const collObs = (volumeId: number, quantity: number): CollectionObservation => ({
  volumeId,
  quantity,
  number: 1,
  anilistId: 30002,
  workId: null,
  publisher: "Ivrea Argentina",
});

describe("propagación tipada de ownedVolumeId (Checkpoint 4B)", () => {
  it("se conserva en matched.legacy (antes de la supresión en el merge)", () => {
    const res = resolveCorrespondence(
      buildCorrespondenceIndex([catRef({ volumeId: 4101, number: 5 })], [legObs({ volume: 5, ownedVolumeId: 111 })]),
    );
    expect(res.matched).toHaveLength(1);
    const id: number = res.matched[0].legacy.ownedVolumeId; // acceso tipado, sin cast
    expect(id).toBe(111);
  });

  it("se conserva en legacyOnly", () => {
    const res = resolveCorrespondence(
      buildCorrespondenceIndex([], [legObs({ editionKey: "edicion-2020", ownedVolumeId: 222 })]),
    );
    expect(res.legacyOnly).toHaveLength(1);
    expect(res.legacyOnly[0].ownedVolumeId).toBe(222);
  });

  it("se conserva para múltiples observaciones legadas dentro de ambiguous", () => {
    const a = legObs({ anilistId: 42, editionKey: "ar", volume: 3, ownedVolumeId: 301 });
    const b = legObs({ anilistId: 42, editionKey: "ar", volume: 3, ownedVolumeId: 302 }); // misma tripla, id distinto
    const res = resolveCorrespondence(buildCorrespondenceIndex([], [a, b]));
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0].legacy.map((x) => x.ownedVolumeId)).toEqual([301, 302]);
  });

  it("las unidades legadas emitidas por mergeOwnership exponen ownedVolumeId tipado", () => {
    const res = resolveCorrespondence(
      buildCorrespondenceIndex([], [legObs({ editionKey: "edicion-2020", ownedVolumeId: 999 })]),
    );
    const result = mergeOwnership(res, []); // legacyOnly → no requiere observaciones de Collection
    const legacyUnits = result.units.filter((u) => u.source === "legacy");
    expect(legacyUnits).toHaveLength(1);
    // Narrowing por `source`: la identidad legada existe SÓLO acá, tipada, sin cast.
    const ids = legacyUnits.map((u) => (u.source === "legacy" ? u.legacy.ownedVolumeId : -1));
    expect(ids).toEqual([999]);
  });

  it("un tomo matched sigue SIN emitirse como unidad legada (supresión intacta)", () => {
    const res = resolveCorrespondence(
      buildCorrespondenceIndex([catRef({ volumeId: 4101, number: 5 })], [legObs({ volume: 5, ownedVolumeId: 111 })]),
    );
    const result = mergeOwnership(res, [collObs(4101, 2)]);
    expect(result.units.filter((u) => u.source === "legacy")).toHaveLength(0);
    expect(result.units.filter((u) => u.source === "collection")).toHaveLength(1);
  });

  it("las reglas de ambigüedad siguen simétricas con L = LegacyObservation (l ≥ 2 → ambiguous)", () => {
    const a = legObs({ anilistId: 7, editionKey: "ivrea", volume: 2, ownedVolumeId: 1 });
    const b = legObs({ anilistId: 7, editionKey: "ivrea", volume: 2, ownedVolumeId: 2 });
    const res = resolveCorrespondence(buildCorrespondenceIndex([], [a, b]));
    expect(res.matched).toHaveLength(0);
    expect(res.legacyOnly).toHaveLength(0);
    expect(res.ambiguous).toHaveLength(1);
  });
});
