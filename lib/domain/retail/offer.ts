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

/**
 * Plan de REORDEN editorial (P-03 · Estudio). PURO. Recibe el conjunto de ofertas de la campaña y el orden
 * pedido, valida que sea una PERMUTACIÓN exacta (mismo conjunto, sin duplicados, sin ids ajenos) y devuelve
 * la asignación `sortOrder = índice`. La validación estricta evita reordenar con datos inconsistentes (bug de
 * cliente o carrera). Idempotente por naturaleza: el mismo orden produce el mismo plan.
 */
export function buildReorderPlan(
  existingOfferIds: readonly number[],
  orderedOfferIds: readonly number[],
): { offerId: number; sortOrder: number }[] {
  if (orderedOfferIds.length !== existingOfferIds.length)
    throw new RetailError(RETAIL_ERROR.INVALID_REORDER_SET, "el orden debe incluir exactamente las ofertas de la campaña");
  const existing = new Set(existingOfferIds);
  const seen = new Set<number>();
  for (const id of orderedOfferIds) {
    if (seen.has(id)) throw new RetailError(RETAIL_ERROR.INVALID_REORDER_SET, `oferta duplicada en el orden: ${id}`);
    if (!existing.has(id)) throw new RetailError(RETAIL_ERROR.INVALID_REORDER_SET, `oferta ajena a la campaña: ${id}`);
    seen.add(id);
  }
  // Igual longitud + sin duplicados + todas pertenecen ⇒ es una permutación exacta.
  return orderedOfferIds.map((offerId, index) => ({ offerId, sortOrder: index }));
}

/** Snapshot histórico de una oferta (resoluble desde Volume → PublisherEdition → Work). Ver §7. */
export interface OfferSnapshot {
  readonly titleSnapshot: string; // Work.title
  readonly volumeNumberSnapshot: number | null; // Volume.number
  readonly publisherSnapshot: string | null; // PublisherEdition.publisher
  readonly isbnSnapshot: string | null; // Volume.isbn (hoy casi siempre null en el catálogo)
}

/**
 * Descriptor comercial de una oferta MANUAL (lanzamiento aún no catalogado, sin Volume). Es lo que la tienda
 * autora a mano; se congela como snapshot al reservar (registro histórico inmutable de lo publicado). El
 * catálogo sigue siendo la autoridad bibliográfica cuando exista un Volume; esto NO lo reemplaza.
 */
export interface ManualOfferDescriptor {
  readonly title: string;
  readonly volumeNumber: number | null;
  readonly publisher: string | null;
  readonly isbn: string | null;
}

const MANUAL_TITLE_MAX = 300;

/**
 * Valida y NORMALIZA un descriptor manual (PURO). Título requerido (trim, ≤ 300); número opcional entero ≥ 0;
 * editorial/ISBN opcionales (trim; vacío → null). Lanza INVALID_TITLE / INVALID_OFFER_DESCRIPTOR. No toca catálogo.
 */
export function assertValidManualDescriptor(input: {
  title: string;
  volumeNumber?: number | null;
  publisher?: string | null;
  isbn?: string | null;
}): ManualOfferDescriptor {
  const title = (input.title ?? "").trim();
  if (title.length === 0)
    throw new RetailError(RETAIL_ERROR.INVALID_TITLE, "el título de la oferta es requerido");
  if (title.length > MANUAL_TITLE_MAX)
    throw new RetailError(RETAIL_ERROR.INVALID_TITLE, `el título no puede superar ${MANUAL_TITLE_MAX} caracteres`);
  const volumeNumber = input.volumeNumber ?? null;
  if (volumeNumber !== null && (!Number.isInteger(volumeNumber) || volumeNumber < 0))
    throw new RetailError(RETAIL_ERROR.INVALID_OFFER_DESCRIPTOR, "el número de tomo debe ser un entero ≥ 0");
  const norm = (s: string | null | undefined): string | null => {
    const t = (s ?? "").trim();
    return t.length === 0 ? null : t;
  };
  return { title, volumeNumber, publisher: norm(input.publisher), isbn: norm(input.isbn) };
}
