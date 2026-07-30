/**
 * Read-side unificado de colección para `/collection` (Retail Pilot, Fase 1 — cableado del read-side).
 *
 * Estrategia: **hidratación aditiva sobre la base legada**. Se parte de `getCollectionItems` (rico, agrupado por
 * edición, con metadata/portadas/autor) y se AGREGAN únicamente los tomos *collection-only* — poseídos en el modelo
 * Collection (`OwnershipPosition`, p. ej. un retiro de preventa) y ausentes del legado —, hidratando su metadata desde
 * el catálogo (`Volume → PublisherEdition → Work`). Ver docs/retail-pilot-collection-read-wiring-design.md.
 *
 * Deduplicación: la reusa el facade `lib/collection-read` (Opción D). Un tomo presente en ambos modelos con la misma
 * tripla `(seriesKey, editionKey, number)` es `matched` y su fila legada ya está en `getCollectionItems`; acá SOLO se
 * agregan las triplas ausentes del legado → nunca se duplica. `ambiguous` y `unmappable` (sin ancla de serie) NO se
 * hidratan en v1 (conservador): se mantiene solo la vista legada existente.
 *
 * Equivalencia por construcción: si el usuario no tiene `OwnershipPosition`, el adapter Collection devuelve `[]`, no
 * hay collection-only y se devuelve `getCollectionItems` sin alterar. Salida = `CollectionItem[]` (misma forma que el
 * legado) → `getCollectionStats` y `CollectionGrid` no cambian. SOLO lectura: no escribe nada, no migra esquema.
 */
import { prisma } from "@/lib/prisma";
import { getCollectionItems, type CollectionItem } from "@/lib/collection";
import { ownershipReader } from "@/lib/collection-read/root";
import { ownedItems } from "@/lib/collection-read/facade";
import { publisherRegion } from "@/lib/publisher-key";

/** Codificación inyectiva de la tripla / par de edición para indexar en `Map`/`Set` (mismo criterio que la correspondencia). */
const tripleKey = (seriesKey: number, editionKey: string, number: number): string =>
  JSON.stringify([seriesKey, editionKey, number]);
const editionKeyOf = (seriesKey: number, editionKey: string): string => JSON.stringify([seriesKey, editionKey]);

/** `id` público del facade para una unidad de Collection = `collection:<volumeId>`. Devuelve el `volumeId` o null. */
function parseCollectionVolumeId(id: string): number | null {
  const m = /^collection:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Metadata de catálogo para construir una edición collection-only nueva (sin contraparte legada). */
type VolumeMeta = {
  title: { romaji: string; english: string | null; native: string | null };
  author: string | null;
  coverImage: string;
  publisherLabel: string;
  region: string;
  editionTotalVolumes: number;
};

/**
 * Hidrata la metadata de catálogo de un conjunto de `volumeId` en UNA query batch (sin N+1): `Volume → PublisherEdition
 * → Work`. La usa el wiring solo para construir ediciones collection-only nuevas; los tomos que caen en una edición
 * legada existente no necesitan metadata (ya la aporta el legado). Fallbacks: título/portada del `Volume`/`PublisherEdition`
 * cuando no hay `Work` mapeado. Nunca rompe la grilla por metadata ausente.
 */
async function hydrateCollectionOnly(volumeIds: number[]): Promise<Map<number, VolumeMeta>> {
  const out = new Map<number, VolumeMeta>();
  if (volumeIds.length === 0) return out;

  const vols = await prisma.volume.findMany({
    where: { id: { in: volumeIds } },
    select: {
      id: true,
      coverImage: true,
      edition: {
        select: {
          publisher: true,
          title: true,
          volumes: true,
          work: {
            select: {
              title: true,
              originalTitle: true,
              titleEn: true,
              titleNative: true,
              author: true,
              coverImage: true,
            },
          },
        },
      },
    },
  });

  for (const v of vols) {
    const w = v.edition.work;
    const romaji = w?.originalTitle || w?.title || v.edition.title || "—";
    out.set(v.id, {
      title: { romaji, english: w?.titleEn ?? null, native: w?.titleNative ?? null },
      author: w?.author ?? null,
      coverImage: w?.coverImage || v.coverImage || "",
      publisherLabel: v.edition.publisher,
      region: publisherRegion(v.edition.publisher),
      editionTotalVolumes: v.edition.volumes,
    });
  }
  return out;
}

/** Clon superficial que aísla el `ownedVolumes` que podemos mutar (no tocar los objetos que devuelve `getCollectionItems`). */
function cloneItem(it: CollectionItem): CollectionItem {
  return { ...it, edition: { ...it.edition, ownedVolumes: [...it.edition.ownedVolumes] } };
}

/**
 * Colección unificada del usuario: base legada + tomos collection-only hidratados del catálogo. Forma idéntica a
 * `getCollectionItems`. Gateada en `/collection` por el flag `unified-collection`.
 */
export async function getCollectionItemsUnified(userId: string): Promise<CollectionItem[]> {
  const [legacyItems, ownership] = await Promise.all([
    getCollectionItems(userId),
    ownershipReader().getUserOwnership(userId),
  ]);
  const owned = ownedItems(ownership);

  // Conjunto de triplas ya presentes en el legado (con su metadata): base de la deduplicación aditiva.
  const legacyTriples = new Set<string>();
  for (const it of legacyItems)
    for (const vol of it.edition.ownedVolumes)
      legacyTriples.add(tripleKey(it.anilistId, it.edition.key, vol));

  // Collection-only = poseído en Collection, mapeable (tiene ancla de serie/edición), no ambiguo y ausente del legado.
  const collectionOnly = owned.filter(
    (i) =>
      i.source === "collection" &&
      !i.ambiguous &&
      i.seriesKey !== null &&
      i.editionKey !== null &&
      !legacyTriples.has(tripleKey(i.seriesKey, i.editionKey, i.number)),
  );

  // Equivalencia por construcción: sin collection-only, la salida es exactamente la legada.
  if (collectionOnly.length === 0) return legacyItems;

  const volumeIds = collectionOnly
    .map((i) => parseCollectionVolumeId(i.id))
    .filter((x): x is number => x !== null);
  const meta = await hydrateCollectionOnly(volumeIds);

  const result: CollectionItem[] = legacyItems.map(cloneItem);
  const byEdition = new Map<string, CollectionItem>();
  for (const it of result) byEdition.set(editionKeyOf(it.anilistId, it.edition.key), it);

  for (const i of collectionOnly) {
    const seriesKey = i.seriesKey as number; // filtrado arriba
    const editionKey = i.editionKey as string;
    const ek = editionKeyOf(seriesKey, editionKey);
    const existing = byEdition.get(ek);
    if (existing) {
      // Tomo nuevo de una edición que el usuario ya trackea: se agrega su número a esa edición.
      if (!existing.edition.ownedVolumes.includes(i.number)) {
        existing.edition.ownedVolumes = [...existing.edition.ownedVolumes, i.number].sort((a, b) => a - b);
      }
      continue;
    }
    // Edición sin contraparte legada: se construye desde la metadata de catálogo (estado de lectura por defecto).
    const volumeId = parseCollectionVolumeId(i.id);
    const m = volumeId !== null ? meta.get(volumeId) : undefined;
    const newItem: CollectionItem = {
      anilistId: seriesKey,
      title: m?.title ?? { romaji: "—", english: null, native: null },
      author: m?.author ?? null,
      coverImage: m?.coverImage ?? "",
      upcoming: false,
      edition: {
        editionId: volumeId !== null ? -volumeId : -1, // sintético: la grilla keyea por (anilistId, edition.key)
        key: editionKey,
        label: m?.publisherLabel ?? editionKey,
        publisher: m?.publisherLabel ?? null,
        region: m?.region ?? "AR",
        totalVolumes: m?.editionTotalVolumes ?? 0,
        status: "IN_PROGRESS",
        readingStatus: "UNREAD",
        readingVolume: null,
        ownedVolumes: [i.number],
      },
    };
    result.push(newItem);
    byEdition.set(ek, newItem);
  }

  return result;
}
