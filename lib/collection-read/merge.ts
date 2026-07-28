/**
 * Merge de posesión (ADR-011, Slice 9 / Checkpoint 2) — aplica la **Opción D**: Collection es autoritativo donde
 * tiene fila; el legado es backstop transitorio sólo donde Collection calla.
 *
 * PURO y de responsabilidad acotada. Consume una `CorrespondenceResolution` YA resuelta (checkpoint 1) + las
 * cantidades observadas de Collection, y produce un resultado de ownership **semántico**. NO: consulta DB, deriva
 * claves editoriales, recomputa correspondencias, conoce Prisma/adapters, registra reconciliación ni decide
 * presentación de UI. La correspondencia decide equivalencias/ambigüedad; el merge sólo aplica autoridad y backstop.
 */
import type {
  CorrespondenceResolution,
  CorrespondenceKey,
  LegacyTomoRef,
} from "@/lib/collection-read/mapping/correspondence";
import type { CollectionObservation } from "@/lib/collection-read/ports";
import { InvalidMergeInput, MERGE_ERROR } from "@/lib/collection-read/errors";

/** Unidad de Collection: identidad = `volumeId`, `owned = quantity > 0` (incluye `owned: false` con `quantity = 0`). */
export type CollectionOwnershipUnit = {
  source: "collection";
  volumeId: number;
  key: CorrespondenceKey | null; // null sólo para unmappableCatalog (sin ancla de serie)
  owned: boolean;
  quantity: number;
  fromAmbiguous: boolean;
};

/**
 * Unidad legada: identidad = la observación legada `L` (booleano ⇒ `owned: true` / `quantity: 1`). Conserva `L`
 * TIPADO, de modo que la identidad persistida (`ownedVolumeId` cuando `L = LegacyObservation`) queda accesible sin
 * casts. `fromAmbiguous` marca las que provienen de una colisión (servidas independientes, sin supresión).
 */
export type LegacyOwnershipUnit<L extends LegacyTomoRef = LegacyTomoRef> = {
  source: "legacy";
  legacy: L;
  owned: true;
  quantity: 1;
  fromAmbiguous: boolean;
};

/** Unión discriminada por `source`: la identidad legada existe SÓLO en las unidades legadas (no diluida en campos opcionales). */
export type OwnershipUnit<L extends LegacyTomoRef = LegacyTomoRef> = CollectionOwnershipUnit | LegacyOwnershipUnit<L>;

export type OwnershipResult<L extends LegacyTomoRef = LegacyTomoRef> = {
  units: OwnershipUnit<L>[];
};

/**
 * Aplica la Opción D sobre la resolución de correspondencia y las cantidades de Collection.
 * O(P + L). Determinista: emite en orden fijo (matched → collectionOnly → unmappableCatalog → legacyOnly →
 * ambiguous), preservando el orden interno de la resolución (heredado del orden de los adapters).
 *
 * **Precondición de biyección** (validada exhaustivamente; ante violación lanza `InvalidMergeInput`, nunca un
 * resultado parcial ni un `quantity` inventado): el conjunto de `volumeId` de Collection referenciados por la
 * resolución (matched, collectionOnly, unmappableCatalog, lado catálogo de ambiguous) debe ser **exactamente** el
 * conjunto de `volumeId` de `collection`, cada uno **una** vez. Además `quantity >= 0`. Una observación faltante NO
 * se degrada a 0: en la Opción D `quantity = 0` es una afirmación autoritativa de no posesión que suprime el legado,
 * así que un faltante por bug de carga no puede volverse una afirmación de dominio falsa.
 */
export function mergeOwnership<L extends LegacyTomoRef = LegacyTomoRef>(
  resolution: CorrespondenceResolution<L>,
  collection: readonly CollectionObservation[],
): OwnershipResult<L> {
  // 1. Indexar observaciones: rechazar quantity inválida y duplicados por volumeId.
  const qty = new Map<number, number>();
  for (const o of collection) {
    if (o.quantity < 0) {
      throw new InvalidMergeInput(MERGE_ERROR.NEGATIVE_QUANTITY, `quantity < 0 para volumeId=${o.volumeId}`);
    }
    if (qty.has(o.volumeId)) {
      throw new InvalidMergeInput(MERGE_ERROR.DUPLICATE_OBSERVATION, `observación duplicada para volumeId=${o.volumeId}`);
    }
    qty.set(o.volumeId, o.quantity);
  }

  // 2. volumeId de Collection requeridos por la resolución.
  const required = new Set<number>();
  for (const m of resolution.matched) required.add(m.volumeId);
  for (const c of resolution.collectionOnly) required.add(c.volumeId);
  for (const u of resolution.unmappableCatalog) required.add(u.volumeId);
  for (const a of resolution.ambiguous) for (const v of a.volumeIds) required.add(v);

  // 3. Cada requerido debe tener exactamente una observación (0 → contrato incompleto).
  for (const volumeId of required) {
    if (!qty.has(volumeId)) {
      throw new InvalidMergeInput(MERGE_ERROR.MISSING_OBSERVATION, `falta CollectionObservation para volumeId=${volumeId}`);
    }
  }

  // 4. Ninguna observación sobrante (biyección: resolución y observaciones del mismo universo).
  for (const volumeId of qty.keys()) {
    if (!required.has(volumeId)) {
      throw new InvalidMergeInput(
        MERGE_ERROR.EXTRANEOUS_OBSERVATION,
        `observación sobrante para volumeId=${volumeId} (no aparece en la resolución)`,
      );
    }
  }

  // 5. Emitir. quantity garantizada presente por la biyección validada arriba (sin `?? 0`).
  const quantityOf = (volumeId: number): number => qty.get(volumeId)!;

  const units: OwnershipUnit<L>[] = [];

  const emitCollection = (volumeId: number, key: CorrespondenceKey | null, fromAmbiguous: boolean): void => {
    const quantity = quantityOf(volumeId);
    units.push({ source: "collection", volumeId, key, owned: quantity > 0, quantity, fromAmbiguous });
  };
  const emitLegacy = (legacy: L, fromAmbiguous: boolean): void => {
    units.push({ source: "legacy", legacy, owned: true, quantity: 1, fromAmbiguous });
  };

  // Collection autoritativo. En `matched`, el tomo legado queda SUPRIMIDO (no se emite): lo representa la unidad de
  // Collection, incluso si `owned: false` por `quantity = 0`.
  for (const m of resolution.matched) emitCollection(m.volumeId, m.key, false);
  for (const c of resolution.collectionOnly) emitCollection(c.volumeId, c.key, false);
  for (const u of resolution.unmappableCatalog) emitCollection(u.volumeId, null, false);
  // Backstop legado: sólo donde Collection calla.
  for (const t of resolution.legacyOnly) emitLegacy(t, false);
  // Ambiguo: se sirve todo independiente, sin supresión ni merge.
  for (const a of resolution.ambiguous) {
    for (const volumeId of a.volumeIds) emitCollection(volumeId, a.key, true);
    for (const t of a.legacy) emitLegacy(t, true);
  }

  return { units };
}
