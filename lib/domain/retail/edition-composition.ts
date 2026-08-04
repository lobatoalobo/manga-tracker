// Composición EDITORIAL de una edición (P-03 · Estudio, ADR-013). Dada la lista de
// ofertas de una campaña + la principal elegida, resuelve la estructura que la UI
// consume tal cual: la principal, las secundarias en portada, el resto (activas
// fuera de portada) y lo que está fuera de venta. La UI NO filtra ni ordena: solo
// mapea buckets a componentes. Misma disciplina que promise-view.
//
// Dominio PURO: no importa Prisma, React, UI ni servicios (lib/retail). Trabaja
// sobre SNAPSHOTS de display (displayTitle/…), no sobre entidades de catálogo — por
// eso nunca consulta nada. No muta la entrada.
//
// No conoce "catálogo" (eso es semántica de producto): el bucket de activas fuera
// de portada se llama `resto`.

/** Estado comercial de la oferta (espeja los literales de OFFER_STATUS por valor). */
export type OfferComposicionStatus = "ACTIVE" | "HIDDEN" | "CANCELLED";

/** Oferta normalizada para componer. Campos de DISPLAY (snapshots), no entidades. */
export type OfferForComposition = {
  readonly offerId: number;
  readonly status: OfferComposicionStatus;
  readonly onCover: boolean;
  readonly sortOrder: number;
  readonly displayTitle: string;
  readonly displayVolume: number | null;
  readonly displayPublisher: string | null;
  readonly listPriceCents: number;
  readonly preorderPriceCents: number;
};

export type ComposeInput = {
  readonly offers: readonly OfferForComposition[];
  readonly principalOfferId: number | null;
};

/** Ítem ya resuelto para render (sin flags de estado/orden: la UI no los necesita). */
export type EditionItem = {
  readonly offerId: number;
  readonly displayTitle: string;
  readonly displayVolume: number | null;
  readonly displayPublisher: string | null;
  readonly listPriceCents: number;
  readonly preorderPriceCents: number;
};

export type EditionComposition = {
  readonly principal: EditionItem | null;
  readonly secundarias: EditionItem[];
  readonly resto: EditionItem[];
  readonly fueraDeVenta: EditionItem[];
};

/** Orden editorial: sortOrder asc, desempate estable por offerId asc. */
function byOrder(a: OfferForComposition, b: OfferForComposition): number {
  return a.sortOrder - b.sortOrder || a.offerId - b.offerId;
}

function toItem(o: OfferForComposition): EditionItem {
  return {
    offerId: o.offerId,
    displayTitle: o.displayTitle,
    displayVolume: o.displayVolume,
    displayPublisher: o.displayPublisher,
    listPriceCents: o.listPriceCents,
    preorderPriceCents: o.preorderPriceCents,
  };
}

/**
 * Resuelve la composición editorial. PURA. Precedencia/reglas:
 *  - principal: solo si la oferta referida EXISTE, es ACTIVE y onCover; si no, `null` DEFENSIVAMENTE
 *    (el servicio debería haberla limpiado, pero el dominio no confía y no rompe).
 *  - secundarias: ACTIVE + onCover, excluyendo la principal válida.
 *  - resto: ACTIVE + !onCover (activas fuera de portada).
 *  - fueraDeVenta: HIDDEN o CANCELLED.
 *  - todos los buckets ordenados por sortOrder (desempate offerId).
 * No muta `input` (ordena sobre una copia).
 */
export function composeEdition(input: ComposeInput): EditionComposition {
  const ordered = [...input.offers].sort(byOrder);

  // Principal: candidata válida sólo si ACTIVE + onCover.
  const candidata =
    input.principalOfferId === null ? undefined : ordered.find((o) => o.offerId === input.principalOfferId);
  const principalValida =
    candidata && candidata.status === "ACTIVE" && candidata.onCover ? candidata : null;
  const principalId = principalValida ? principalValida.offerId : null;

  const secundarias: EditionItem[] = [];
  const resto: EditionItem[] = [];
  const fueraDeVenta: EditionItem[] = [];

  for (const o of ordered) {
    if (o.status !== "ACTIVE") {
      fueraDeVenta.push(toItem(o)); // HIDDEN | CANCELLED
    } else if (o.onCover) {
      if (o.offerId !== principalId) secundarias.push(toItem(o)); // la principal no va en secundarias
    } else {
      resto.push(toItem(o)); // activa fuera de portada
    }
  }

  return {
    principal: principalValida ? toItem(principalValida) : null,
    secundarias,
    resto,
    fueraDeVenta,
  };
}
