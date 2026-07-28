/**
 * Reconciliación observable del read-side unificado (ADR-011, Slice 9 / Checkpoint 6). Frontera estricta:
 * `correspondence`/`merge` **producen** la verdad semántica; la reconciliación **observa y describe** esa verdad.
 *
 * Reporte PURO derivado de `CorrespondenceResolution` (+ cantidades del `OwnershipResult`). NO cambia el resultado
 * del facade, NO repara datos, NO hace backfill, NO adivina correspondencias, NO captura/degrada errores del merge,
 * NO escribe tabla nueva (F1), NO depende de logging/métricas (el sink lo inyecta la capa de app). Es reutilizable
 * por cobertura (conteos), auditoría (contradicciones/ambigüedades) y la futura F2 (identidades conservadas).
 */
import type {
  CorrespondenceKey,
  CorrespondenceResolution,
  LegacyTomoRef,
} from "@/lib/collection-read/mapping/correspondence";
import type { OwnershipResult } from "@/lib/collection-read/merge";

export type ReconciliationCounts = {
  matched: number;
  collectionOnly: number;
  legacyOnly: number;
  unmappableCatalog: number;
  ambiguous: number; // grupos ambiguos (triplas colisionadas)
  collectionZeroQuantity: number; // posiciones Collection con quantity = 0 (afirmación autoritativa de no posesión)
  // Subconjunto de las anteriores: `matched` con quantity = 0 ⇒ Collection suprime un tomo legado poseído, salida
  // visible owned:false. Es la contradicción resuelta por autoridad de Collection.
  authorityContradictions: number;
};

/** Reporte puro. Conserva las IDENTIDADES persistidas de los casos problemáticos (vía `L` y `volumeId`), no sólo conteos. */
export type ReconciliationReport<L extends LegacyTomoRef = LegacyTomoRef> = {
  counts: ReconciliationCounts;
  ambiguities: { key: CorrespondenceKey; volumeIds: number[]; legacy: L[] }[];
  authorityContradictions: { volumeId: number; key: CorrespondenceKey; legacy: L }[];
  unmappableCatalog: { volumeId: number }[];
  collectionZeroQuantity: { volumeId: number }[];
};

/**
 * Sink inyectable para publicar el reporte. La capa de app decide qué hacer (logging/métricas viven fuera del dominio).
 * Puede ser síncrono o asíncrono: la fachada lo **espera** (`await`) para que un rechazo asíncrono también quede
 * aislado por su try/catch — un sink `async` usado como callback `void` dejaría el rechazo fuera del aislamiento.
 */
export type ReconciliationSink<L extends LegacyTomoRef = LegacyTomoRef> = (
  report: ReconciliationReport<L>,
) => void | Promise<void>;

// Nota: no se exporta un sink no-op por defecto: la ausencia de `reconciliationSink` en la fachada YA significa
// "sin observabilidad" (el reporte ni se construye), así que un no-op explícito sería redundante y código muerto.

/**
 * Construye el reporte a partir de la resolución (categorías + identidades) y el resultado del merge (cantidades).
 * Puro y determinista; O(P + L). No recomputa correspondencia ni merge: sólo los describe.
 */
export function buildReconciliationReport<L extends LegacyTomoRef = LegacyTomoRef>(
  resolution: CorrespondenceResolution<L>,
  result: OwnershipResult<L>,
): ReconciliationReport<L> {
  const qtyByVolume = new Map<number, number>();
  const collectionZeroQuantity: { volumeId: number }[] = [];
  for (const u of result.units) {
    if (u.source === "collection") {
      qtyByVolume.set(u.volumeId, u.quantity);
      if (u.quantity === 0) collectionZeroQuantity.push({ volumeId: u.volumeId });
    }
  }

  // Contradicción de autoridad: un `matched` cuya posición Collection es 0 (el tomo legado poseído queda suprimido).
  const authorityContradictions = resolution.matched
    .filter((m) => qtyByVolume.get(m.volumeId) === 0)
    .map((m) => ({ volumeId: m.volumeId, key: m.key, legacy: m.legacy }));

  const ambiguities = resolution.ambiguous.map((a) => ({ key: a.key, volumeIds: a.volumeIds, legacy: a.legacy }));
  const unmappableCatalog = resolution.unmappableCatalog.map((u) => ({ volumeId: u.volumeId }));

  return {
    counts: {
      matched: resolution.matched.length,
      collectionOnly: resolution.collectionOnly.length,
      legacyOnly: resolution.legacyOnly.length,
      unmappableCatalog: resolution.unmappableCatalog.length,
      ambiguous: resolution.ambiguous.length,
      collectionZeroQuantity: collectionZeroQuantity.length,
      authorityContradictions: authorityContradictions.length,
    },
    ambiguities,
    authorityContradictions,
    unmappableCatalog,
    collectionZeroQuantity,
  };
}
