/**
 * Fachada de lectura del read-side unificado (ADR-011, Slice 9 / Checkpoint 5): **orquestación** + contrato público.
 *
 * Fronteras: los **adapters** producen observaciones fieles; la **correspondencia** decide equivalencias/ambigüedad;
 * el **merge** aplica autoridad y backstop; la **fachada** carga ambas fuentes, corre correspondencia + merge y
 * transforma a DTOs públicos. NO: consulta Prisma directo (usa los `OwnershipSource` inyectados), reimplementa
 * mapping/merge, oculta ambigüedades, muta datos, hace backfill, registra reconciliación persistente ni conoce UI.
 *
 * Errores: propaga (fail-fast) los de adapters/merge; no captura, no produce resultados parciales, no degrada.
 */
import { buildCorrespondenceIndex, resolveCorrespondence } from "@/lib/collection-read/mapping/correspondence";
import { mergeOwnership } from "@/lib/collection-read/merge";
import { buildReconciliationReport, type ReconciliationSink } from "@/lib/collection-read/reconciliation";
import type {
  CollectionObservation,
  LegacyObservation,
  OwnershipSource,
} from "@/lib/collection-read/ports";

/**
 * Dependencias inyectadas: una fuente por eje. La fachada es Prisma-free; los adapters concretos llevan el client.
 * `reconciliationSink` es opcional (default = no observabilidad): observa el resultado sin alterarlo.
 */
export type OwnershipReadSources = {
  collection: OwnershipSource<CollectionObservation>;
  legacy: OwnershipSource<LegacyObservation>;
  reconciliationSink?: ReconciliationSink<LegacyObservation>;
};

export type OwnershipItemSource = "collection" | "legacy";

/**
 * DTO público de un tomo. `id` = identidad **persistida** estable (`collection:<volumeId>` | `legacy:<ownedVolumeId>`),
 * nunca la tripla heurística. `seriesKey`/`editionKey` son metadata descriptiva (de la clave de correspondencia para
 * Collection; de la coordenada legada para el legado); `null` cuando no hay ancla (unmappable). `owned` refleja la
 * verdad semántica (incluye `false` con `quantity = 0`). `ambiguous` expone `fromAmbiguous` — la ambigüedad NO se oculta.
 */
export type OwnershipItem = {
  id: string;
  source: OwnershipItemSource;
  owned: boolean;
  quantity: number;
  seriesKey: number | null;
  editionKey: string | null;
  number: number;
  ambiguous: boolean;
};

export type OwnershipView = { items: OwnershipItem[] };

const cmpNum = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b; // null al final
const cmpStr = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1; // null al final

/** Orden contractual determinista y total: serie → edición → tomo → source → id (desempate estable). */
function compareItems(a: OwnershipItem, b: OwnershipItem): number {
  return (
    cmpNum(a.seriesKey, b.seriesKey) ||
    cmpStr(a.editionKey, b.editionKey) ||
    a.number - b.number ||
    (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function createOwnershipReader(sources: OwnershipReadSources) {
  return {
    /** Vista unificada de posesión del usuario. Incluye unidades `owned: false` (verdad semántica; no se filtran). */
    async getUserOwnership(userId: string): Promise<OwnershipView> {
      const [collectionObs, legacyObs] = await Promise.all([
        sources.collection.observe(userId),
        sources.legacy.observe(userId),
      ]);

      // Correspondencia (L = LegacyObservation ⇒ ownedVolumeId conservado tipado) + merge (Opción D).
      const resolution = resolveCorrespondence(buildCorrespondenceIndex(collectionObs, legacyObs));
      const result = mergeOwnership(resolution, collectionObs);

      const obsByVolume = new Map(collectionObs.map((o) => [o.volumeId, o]));
      const items = result.units.map((u): OwnershipItem => {
        if (u.source === "collection") {
          // Presente por la biyección que mergeOwnership ya validó.
          const number = obsByVolume.get(u.volumeId)!.number;
          return {
            id: `collection:${u.volumeId}`,
            source: "collection",
            owned: u.owned,
            quantity: u.quantity,
            seriesKey: u.key ? u.key.seriesKey : null,
            editionKey: u.key ? u.key.editionKey : null,
            number,
            ambiguous: u.fromAmbiguous,
          };
        }
        return {
          id: `legacy:${u.legacy.ownedVolumeId}`,
          source: "legacy",
          owned: true,
          quantity: 1,
          seriesKey: u.legacy.anilistId, // ya codifica positivo=AniList / negativo=-workId
          editionKey: u.legacy.editionKey,
          number: u.legacy.volume,
          ambiguous: u.fromAmbiguous,
        };
      });

      items.sort(compareItems);

      // Observabilidad: derivada de (resolution, result), NO altera `items`. El fallo del sink NO degrada la lectura
      // (best-effort); los errores del merge, en cambio, ya propagaron fail-fast antes de llegar acá. Se `await`ea el
      // sink (que puede ser async) para que un rechazo asíncrono quede dentro del try/catch — un `void sink(report)`
      // dejaría el rechazo como unhandled y rompería la garantía "la lectura nunca falla por observabilidad".
      if (sources.reconciliationSink) {
        const report = buildReconciliationReport(resolution, result);
        try {
          await sources.reconciliationSink(report);
        } catch {
          // el sink es best-effort; la lectura nunca falla por observabilidad (logging vive en el sink, no acá)
        }
      }

      return { items };
    },
  };
}

/**
 * Proyección pública EXPLÍCITA "solo poseídos". El core no filtra `owned: false` (preserva la verdad semántica); un
 * consumidor que quiera esa vista la pide expresamente con esta operación.
 */
export function ownedItems(view: OwnershipView): OwnershipItem[] {
  return view.items.filter((i) => i.owned);
}
