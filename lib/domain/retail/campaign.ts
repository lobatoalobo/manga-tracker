/**
 * Dominio de Retail — máquina de estados y políticas de una PreorderCampaign. PURO (sin Prisma, sin reloj
 * implícito: `now` se INYECTA). El `status` es historia explícita; el TIEMPO (`opensAt`/`closesAt`) solo
 * decide la disponibilidad pública para futuras reservas — nunca cambia el status por sí mismo (no hay cron).
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

export const CAMPAIGN_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

/**
 * Transiciones permitidas. `CLOSED`/`CANCELLED` son TERMINALES (no se reabren: reabrir una campaña
 * publicada/cerrada cambiaría la semántica histórica; si algún día hace falta, es una decisión de producto
 * documentada, no un atajo). No hay `ARCHIVED`: CLOSED + CANCELLED cubren el historial en v1.
 */
const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: [CAMPAIGN_STATUS.PUBLISHED, CAMPAIGN_STATUS.CANCELLED],
  PUBLISHED: [CAMPAIGN_STATUS.CLOSED, CAMPAIGN_STATUS.CANCELLED],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertCampaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransitionCampaign(from, to))
    throw new RetailError(RETAIL_ERROR.INVALID_CAMPAIGN_TRANSITION, `no se puede pasar de ${from} a ${to}`);
}

/** Solo una campaña DRAFT se edita libremente (título/fechas/ofertas/precios/volúmenes). */
export function isDraftEditable(status: CampaignStatus): boolean {
  return status === CAMPAIGN_STATUS.DRAFT;
}
export function assertDraftEditable(status: CampaignStatus): void {
  if (!isDraftEditable(status)) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE, `campaña en estado ${status}`);
}

/**
 * Campos editables tras PUBLICAR (§13, congelado): SOLO la descripción pública. Los campos COMERCIALES
 * (título, fechas, precios, volúmenes de oferta) quedan PROTEGIDOS desde la publicación para no cambiar la
 * semántica cuando Slice 3 sume reservas. Ocultar/cancelar ofertas y cerrar la campaña son operaciones
 * explícitas aparte (no "edición" del borrador).
 */
export const PUBLISHED_EDITABLE_FIELDS = ["description"] as const;

/** Título válido (no vacío tras trim). */
export function assertValidTitle(title: string): string {
  const t = (title ?? "").trim();
  if (!t) throw new RetailError(RETAIL_ERROR.INVALID_TITLE, "el título no puede estar vacío");
  return t;
}

/** Fechas coherentes: si ambas están, opensAt < closesAt. */
export function assertValidDates(opensAt: Date | null, closesAt: Date | null): void {
  if (opensAt && closesAt && opensAt.getTime() >= closesAt.getTime())
    throw new RetailError(RETAIL_ERROR.INVALID_DATES, "opensAt debe ser anterior a closesAt");
}

/** Vista mínima para decidir disponibilidad pública (temporal). */
export interface CampaignAvailabilityView {
  readonly status: CampaignStatus;
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
  /** La tienda comercial debe estar habilitada para aceptar reservas. */
  readonly storeEnabled: boolean;
}

/**
 * ¿La campaña está ABIERTA (aceptaría futuras reservas) en el instante `now`? PURA, `now` inyectado.
 * Requiere: PUBLISHED + tienda habilitada + dentro de la ventana [opensAt, closesAt). NO muta el status.
 */
export function isCampaignOpen(c: CampaignAvailabilityView, now: Date): boolean {
  if (c.status !== CAMPAIGN_STATUS.PUBLISHED || !c.storeEnabled) return false;
  if (c.opensAt && now.getTime() < c.opensAt.getTime()) return false;
  if (c.closesAt && now.getTime() >= c.closesAt.getTime()) return false;
  return true;
}

/** Vista para validar la publicación (§12). PURA. */
export interface PublishableView {
  readonly title: string;
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
  readonly storeEnabled: boolean;
  readonly activeOfferCount: number;
}

/**
 * Precondiciones de PUBLICAR (§12): tienda habilitada, título válido, fechas coherentes y ≥1 oferta ACTIVE.
 * PURA (lanza RetailError). La unicidad de Volume y la validez de precios se garantizan al agregar la
 * oferta (unique + assertValidPrices), así que acá solo se re-afirma lo agregado.
 */
export function assertPublishable(v: PublishableView): void {
  if (!v.storeEnabled) throw new RetailError(RETAIL_ERROR.STORE_COMMERCE_DISABLED, "la tienda comercial no está habilitada");
  assertValidTitle(v.title);
  assertValidDates(v.opensAt, v.closesAt);
  if (v.activeOfferCount < 1) throw new RetailError(RETAIL_ERROR.CAMPAIGN_HAS_NO_OFFERS, "la campaña no tiene ofertas activas");
}

/** Etiqueta pública derivada del estado + tiempo (para la UI de lectura; no persiste). */
export function publicAvailabilityLabel(c: CampaignAvailabilityView, now: Date): "OPEN" | "NOT_YET" | "ENDED" | "CLOSED" {
  if (c.status === CAMPAIGN_STATUS.CLOSED) return "CLOSED";
  if (isCampaignOpen(c, now)) return "OPEN";
  if (c.opensAt && now.getTime() < c.opensAt.getTime()) return "NOT_YET";
  if (c.closesAt && now.getTime() >= c.closesAt.getTime()) return "ENDED";
  return "NOT_YET";
}
