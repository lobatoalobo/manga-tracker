/**
 * Dominio de Retail — PreorderOffer: estados, transiciones y PRECIOS. PURO.
 *
 * Precios en **enteros de unidad mínima (centavos de ARS)** — NO Float (evita el tipo `Float` del repo y
 * sus errores de redondeo). Fuente de verdad = `listPriceCents` + `preorderPriceCents`; el `discountPercent`
 * es DERIVADO (no se persiste → no hay tres fuentes de verdad). Moneda única (ARS) en esta slice.
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

export const OFFER_STATUS = {
  ACTIVE: "ACTIVE",
  HIDDEN: "HIDDEN",
  CANCELLED: "CANCELLED",
} as const;
export type OfferStatus = (typeof OFFER_STATUS)[keyof typeof OFFER_STATUS];

const OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  ACTIVE: [OFFER_STATUS.HIDDEN, OFFER_STATUS.CANCELLED],
  HIDDEN: [OFFER_STATUS.ACTIVE, OFFER_STATUS.CANCELLED],
  CANCELLED: [], // terminal
};

export function canTransitionOffer(from: OfferStatus, to: OfferStatus): boolean {
  return OFFER_TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertOfferTransition(from: OfferStatus, to: OfferStatus): void {
  if (!canTransitionOffer(from, to))
    throw new RetailError(RETAIL_ERROR.OFFER_NOT_EDITABLE, `no se puede pasar la oferta de ${from} a ${to}`);
}

/**
 * Reglas de precio: `list >= 0`, `preorder >= 0`, `preorder <= list`. Enteros (centavos). Lanza INVALID_PRICE.
 */
export function assertValidPrices(listPriceCents: number, preorderPriceCents: number): void {
  const ok = (n: number) => Number.isInteger(n) && n >= 0;
  if (!ok(listPriceCents) || !ok(preorderPriceCents))
    throw new RetailError(RETAIL_ERROR.INVALID_PRICE, "los precios deben ser enteros ≥ 0 (centavos)");
  if (preorderPriceCents > listPriceCents)
    throw new RetailError(RETAIL_ERROR.INVALID_PRICE, "el precio de preventa no puede superar al de lista");
}

/** Descuento DERIVADO (porcentaje entero, para la UI). 0 si el precio de lista es 0. */
export function derivedDiscountPercent(listPriceCents: number, preorderPriceCents: number): number {
  if (listPriceCents <= 0) return 0;
  return Math.round((1 - preorderPriceCents / listPriceCents) * 100);
}

/** Snapshot histórico de una oferta (resoluble desde Volume → PublisherEdition → Work). Ver §7. */
export interface OfferSnapshot {
  readonly titleSnapshot: string; // Work.title
  readonly volumeNumberSnapshot: number | null; // Volume.number
  readonly publisherSnapshot: string | null; // PublisherEdition.publisher
  readonly isbnSnapshot: string | null; // Volume.isbn (hoy casi siempre null en el catálogo)
}
