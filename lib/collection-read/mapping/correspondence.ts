/**
 * Correspondencia entre los dos ejes de identidad de colección (ADR-011, Slice 9 / Checkpoint 1): el catálogo
 * (`Volume` → `PublisherEdition`) y el legado (`Manga` / `TrackedEdition` / `OwnedVolume`).
 *
 * PURA: sin DB, sin reloj, sin azar. Los adapters cargan las refs ya resueltas; acá solo se **deriva**, se
 * **indexa** y se **resuelve**. No hay ningún id fuerte compartido entre `OwnedVolume` y el `Volume` del catálogo
 * (el legado no tiene whakoomId/isbn), así que la ÚNICA identidad común entre ejes es la tripla
 * `(seriesKey, editionKey, number)`. El eje de edición es heurístico (via `publisherKey`, fuente única en
 * `lib/publisher-key.ts`); ante colisión de la tripla NUNCA se adivina un match.
 *
 * Pipeline: deriveCatalogKey/deriveLegacyKey → buildCorrespondenceIndex → resolveCorrespondence. El índice es el
 * substrato reutilizable (reconciliación, cobertura, backfill, auditoría) sin correr la resolución completa.
 * Ver docs/retail-slice-9-unified-collection-read-side.md §13.
 */
import { publisherKey } from "@/lib/publisher-key";

// --- Entradas (ya cargadas por los adapters; la función es pura) ------------------------------------------------

/** Volumen del catálogo con lo mínimo para ubicarlo en el eje legado. */
export type CatalogVolumeRef = {
  volumeId: number;
  number: number;
  anilistId: number | null; // de PublisherEdition
  workId: number | null; // de PublisherEdition
  publisher: string; // de PublisherEdition
};

/** Tomo poseído en el legado: coordenada `(Manga.anilistId, TrackedEdition.key, OwnedVolume.volume)`. */
export type LegacyTomoRef = {
  anilistId: number; // positivo (AniList) o -workId (obra local); nunca null
  editionKey: string; // TrackedEdition.key
  volume: number; // OwnedVolume.volume
};

// --- Clave de correspondencia ----------------------------------------------------------------------------------

/** Identidad compartida entre ejes. Dos entradas corresponden ⟺ producen la misma clave (y es unívoca). */
export type CorrespondenceKey = {
  seriesKey: number;
  editionKey: string;
  number: number;
};

/**
 * Codificación string INYECTIVA de la tripla, para agrupar en `Map`. Se usa `JSON.stringify` de una tupla: escapa
 * comillas/comas/corchetes, así es inequívoca para CUALQUIER `editionKey`, sin depender de un delimitador que
 * pudiera aparecer dentro de la key.
 */
function keyString(k: CorrespondenceKey): string {
  return JSON.stringify([k.seriesKey, k.editionKey, k.number]);
}

/**
 * Ancla de serie del catálogo: AniList id si es válido (>0), si no `-workId` (convención de obra local que el
 * legado ya usa). `0` es un id inválido (mismo criterio que el legado) → sin ancla. `null` si no hay ninguno.
 */
function catalogSeriesKey(anilistId: number | null, workId: number | null): number | null {
  if (anilistId != null && anilistId !== 0) return anilistId;
  if (workId != null) return -workId;
  return null;
}

/** Deriva la clave de un volumen del catálogo. `null` = UNMAPPABLE (sin ancla de serie): no ubicable en el legado. */
export function deriveCatalogKey(v: CatalogVolumeRef): CorrespondenceKey | null {
  const seriesKey = catalogSeriesKey(v.anilistId, v.workId);
  if (seriesKey === null) return null;
  return { seriesKey, editionKey: publisherKey(v.publisher), number: v.number };
}

/** Deriva la clave de un tomo legado. El legado SIEMPRE tiene tripla (su coordenada ya es la identidad). */
export function deriveLegacyKey(t: LegacyTomoRef): CorrespondenceKey {
  return { seriesKey: t.anilistId, editionKey: t.editionKey, number: t.volume };
}

// --- Índice ----------------------------------------------------------------------------------------------------

// Genérico sobre `L extends LegacyTomoRef` (default `LegacyTomoRef`): el índice/resolución CONSERVAN el subtipo
// legado tal cual lo produjo el adapter (p.ej. `LegacyObservation` con `ownedVolumeId`), tipado y sin casts. `L` NO
// participa de la correspondencia (la tripla `(seriesKey, editionKey, number)` sigue decidiendo equivalencias).
export type CorrespondenceIndexEntry<L extends LegacyTomoRef = LegacyTomoRef> = {
  key: CorrespondenceKey;
  catalog: { volumeId: number }[]; // volúmenes del catálogo que derivaron esta tripla (≥1)
  // Tomos legados que derivaron esta tripla. Puede ser ≥2: aunque los @@unique del legado la hacen única POR
  // USUARIO hoy, no se asume — esos índices garantizan unicidad de la identidad PERSISTIDA, no de la tripla
  // DERIVADA de correspondencia. Dos filas podrían colapsar aquí; se trata como colisión, no se elige una.
  legacy: L[];
};

export type CorrespondenceIndex<L extends LegacyTomoRef = LegacyTomoRef> = {
  byKey: ReadonlyMap<string, CorrespondenceIndexEntry<L>>;
  unmappableCatalog: readonly { volumeId: number }[]; // deriveCatalogKey === null
};

/**
 * Agrupa ambos lados por la tripla e inventaría lo no ubicable. Detecta colisiones estructuralmente y de forma
 * SIMÉTRICA (`catalog.length ≥ 2` o `legacy.length ≥ 2`). O(P + L): una pasada por cada lado, sin ordenar; preserva
 * el orden de entrada (los adapters cargan con `orderBy` determinista). Substrato reutilizable por
 * reconciliación/cobertura/backfill/auditoría.
 */
export function buildCorrespondenceIndex<L extends LegacyTomoRef = LegacyTomoRef>(
  catalog: readonly CatalogVolumeRef[],
  legacy: readonly L[],
): CorrespondenceIndex<L> {
  const byKey = new Map<string, CorrespondenceIndexEntry<L>>();
  const unmappableCatalog: { volumeId: number }[] = [];

  const ensure = (key: CorrespondenceKey): CorrespondenceIndexEntry<L> => {
    const ks = keyString(key);
    let entry = byKey.get(ks);
    if (!entry) {
      entry = { key, catalog: [], legacy: [] };
      byKey.set(ks, entry);
    }
    return entry;
  };

  for (const v of catalog) {
    const key = deriveCatalogKey(v);
    if (key === null) {
      unmappableCatalog.push({ volumeId: v.volumeId });
      continue;
    }
    ensure(key).catalog.push({ volumeId: v.volumeId });
  }
  for (const t of legacy) {
    ensure(deriveLegacyKey(t)).legacy.push(t);
  }

  return { byKey, unmappableCatalog };
}

// --- Resolución ------------------------------------------------------------------------------------------------

export type CorrespondenceResolution<L extends LegacyTomoRef = LegacyTomoRef> = {
  matched: { key: CorrespondenceKey; volumeId: number; legacy: L }[]; // 1:1 unívoca (conserva L)
  collectionOnly: { key: CorrespondenceKey; volumeId: number }[]; // posición sin par legado
  legacyOnly: L[]; // tomo legado sin par (lo sirve el backstop) — conserva L
  unmappableCatalog: { volumeId: number }[]; // posición sin ancla de serie
  ambiguous: { key: CorrespondenceKey; volumeIds: number[]; legacy: L[] }[]; // colisión → nunca adivina (conserva L)
};

/**
 * Clasifica el índice en las cinco categorías exhaustivas y disjuntas de la Opción D. Es una **vista** del índice
 * (no lo recomputa). O(#claves). El merge suprime del legado SOLO los `matched`; sirve `collectionOnly` y
 * `unmappableCatalog` desde Collection; `legacyOnly` desde el legado; y en `ambiguous` sirve todo independiente.
 * La ambigüedad es SIMÉTRICA: `matched` requiere exactamente 1 en cada lado; cualquier `≥2` (catálogo o legado)
 * es ambiguo → nunca se selecciona arbitrariamente un registro (ni de catálogo ni legado).
 */
export function resolveCorrespondence<L extends LegacyTomoRef = LegacyTomoRef>(
  index: CorrespondenceIndex<L>,
): CorrespondenceResolution<L> {
  const matched: CorrespondenceResolution<L>["matched"] = [];
  const collectionOnly: CorrespondenceResolution<L>["collectionOnly"] = [];
  const legacyOnly: CorrespondenceResolution<L>["legacyOnly"] = [];
  const ambiguous: CorrespondenceResolution<L>["ambiguous"] = [];

  for (const e of index.byKey.values()) {
    const c = e.catalog.length;
    const l = e.legacy.length;
    if (c >= 2 || l >= 2) {
      // Colisión en cualquiera de los dos lados: la tripla no es una identidad unívoca. No se afirma ningún 1:1.
      ambiguous.push({ key: e.key, volumeIds: e.catalog.map((x) => x.volumeId), legacy: e.legacy });
    } else if (c === 1 && l === 1) {
      matched.push({ key: e.key, volumeId: e.catalog[0].volumeId, legacy: e.legacy[0] });
    } else if (c === 1) {
      collectionOnly.push({ key: e.key, volumeId: e.catalog[0].volumeId });
    } else if (l === 1) {
      legacyOnly.push(e.legacy[0]);
    }
    // c === 0 && l === 0 es imposible: una entrada se crea solo al insertar algo.
  }

  return { matched, collectionOnly, legacyOnly, unmappableCatalog: [...index.unmappableCatalog], ambiguous };
}
