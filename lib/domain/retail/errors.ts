/**
 * Dominio de Retail / Preventas — errores de dominio con `code` estable. PURO. NO se depende de mensajes
 * de Prisma como contrato: los conflictos de base (P2002/P2003) se TRADUCEN a estos códigos en la infra.
 */
export const RETAIL_ERROR = {
  CAMPAIGN_NOT_FOUND: "CAMPAIGN_NOT_FOUND",
  CAMPAIGN_NOT_EDITABLE: "CAMPAIGN_NOT_EDITABLE",
  INVALID_CAMPAIGN_TRANSITION: "INVALID_CAMPAIGN_TRANSITION",
  CAMPAIGN_NOT_OPEN: "CAMPAIGN_NOT_OPEN",
  CAMPAIGN_HAS_NO_OFFERS: "CAMPAIGN_HAS_NO_OFFERS",
  OFFER_ALREADY_EXISTS: "OFFER_ALREADY_EXISTS",
  OFFER_NOT_FOUND: "OFFER_NOT_FOUND",
  OFFER_NOT_EDITABLE: "OFFER_NOT_EDITABLE",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_DATES: "INVALID_DATES",
  INVALID_TITLE: "INVALID_TITLE",
  VOLUME_NOT_FOUND: "VOLUME_NOT_FOUND",
  STORE_COMMERCE_DISABLED: "STORE_COMMERCE_DISABLED",
} as const;
export type RetailErrorCode = (typeof RETAIL_ERROR)[keyof typeof RETAIL_ERROR];

export class RetailError extends Error {
  constructor(readonly code: RetailErrorCode, message?: string) {
    super(message ?? `retail: ${code}`);
    this.name = "RetailError";
  }
}
