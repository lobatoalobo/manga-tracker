/**
 * Infra de Retail — estado del ESTUDIO SaaS de una preventa (borrador). Un DTO plano y serializable que
 * viaja a la pantalla cliente: datos generales + ofertas con sus metadatos de vista previa. Reutiliza
 * `getStoreCampaign` (autoriza como miembro, incluye ofertas ordenadas). Sin lógica de negocio nueva.
 */
import { getStoreCampaign } from "@/lib/retail/campaigns";
import { OFFER_STATUS } from "@/lib/domain/retail/offer";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

export interface StudioOffer {
  id: number;
  title: string;
  volumeNumber: number | null;
  publisher: string | null;
  isbn: string | null;
  volumeId: number | null;
  listPriceCents: number;
  preorderPriceCents: number;
  status: "ACTIVE" | "HIDDEN" | "CANCELLED";
  sortOrder: number;
  isReprint: boolean;
  publisherDiscountPct: number | null;
}

export interface StudioState {
  campaignId: number;
  title: string;
  opensAt: string | null; // ISO (el cliente lo pasa a datetime-local)
  closesAt: string | null;
  description: string;
  status: string; // DRAFT | PUBLISHED | ...
  offers: StudioOffer[];
}

type CampaignWithOffers = Awaited<ReturnType<typeof getStoreCampaign>>;

export function mapStudioState(c: CampaignWithOffers): StudioState {
  return {
    campaignId: c.id,
    title: c.title,
    opensAt: c.opensAt ? c.opensAt.toISOString() : null,
    closesAt: c.closesAt ? c.closesAt.toISOString() : null,
    description: c.description ?? "",
    status: c.status,
    offers: [...c.offers]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((o) => ({
        id: o.id,
        title: o.titleSnapshot,
        volumeNumber: o.volumeNumberSnapshot,
        publisher: o.publisherSnapshot,
        isbn: o.isbnSnapshot,
        volumeId: o.volumeId,
        listPriceCents: o.listPriceCents,
        preorderPriceCents: o.preorderPriceCents,
        status: o.status as StudioOffer["status"],
        sortOrder: o.sortOrder,
        isReprint: o.isReprint,
        publisherDiscountPct: o.publisherDiscountPct,
      })),
  };
}

/**
 * Carga el estado del estudio (autoriza como miembro dentro de getStoreCampaign). `expectedStoreId` evita
 * cargar por `?draft` una campaña de OTRA tienda de la que el actor también sea miembro.
 */
export async function loadStudioState(campaignId: number, actorUserId: string | null, expectedStoreId?: number): Promise<StudioState> {
  const c = await getStoreCampaign(campaignId, actorUserId);
  if (expectedStoreId != null && c.storeId !== expectedStoreId) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  return mapStudioState(c);
}

/** Ofertas visibles en la lista del estudio (activas + pausadas; las de baja/quitadas no se listan). */
export function listableOffers(state: StudioState): StudioOffer[] {
  return state.offers.filter((o) => o.status === OFFER_STATUS.ACTIVE || o.status === OFFER_STATUS.HIDDEN);
}

/** Ofertas ACTIVAS (para resumen, precio-desde y publicación). */
export function activeOffers(state: StudioState): StudioOffer[] {
  return state.offers.filter((o) => o.status === OFFER_STATUS.ACTIVE);
}
