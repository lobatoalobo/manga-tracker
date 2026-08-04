/**
 * Estudio de la edición (P-03) — mapper de DISPLAY: de la oferta persistida a la fila serializable que consume
 * el cliente (y `edition-composition`). PURO: solo renombra snapshots→display, sin reglas ni Prisma. La usan
 * tanto la pantalla RSC como el resultado de `addOfferAction`.
 */

export type StudioOfferRow = {
  offerId: number;
  displayTitle: string;
  displayVolume: number | null;
  displayPublisher: string | null;
  listPriceCents: number;
  preorderPriceCents: number;
  status: string;
  onCover: boolean;
  sortOrder: number;
};

/** Forma mínima de la oferta persistida que necesita el mapper (subconjunto de `PreorderOffer`). */
export type OfferSnapshotRow = {
  id: number;
  titleSnapshot: string;
  volumeNumberSnapshot: number | null;
  publisherSnapshot: string | null;
  listPriceCents: number;
  preorderPriceCents: number;
  status: string;
  onCover: boolean;
  sortOrder: number;
};

export function toStudioOfferRow(o: OfferSnapshotRow): StudioOfferRow {
  return {
    offerId: o.id,
    displayTitle: o.titleSnapshot,
    displayVolume: o.volumeNumberSnapshot,
    displayPublisher: o.publisherSnapshot,
    listPriceCents: o.listPriceCents,
    preorderPriceCents: o.preorderPriceCents,
    status: o.status,
    onCover: o.onCover,
    sortOrder: o.sortOrder,
  };
}
