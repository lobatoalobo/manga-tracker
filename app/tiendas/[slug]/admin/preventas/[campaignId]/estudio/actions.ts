"use server";

/**
 * Server actions del ESTUDIO de la edición (P-03, ADR-013). Adaptadores DELGADOS sesión → servicio: resuelven
 * `actorUserId` con `requireUserId`, delegan autorización y reglas al servicio (que deriva `storeId` de la
 * entidad y valida pertenencia/estado), y devuelven un resultado UNIFORME y serializable suficiente para que el
 * cliente reconcilie el optimista (o refresque). No reimplementan dominio. No usan `revalidatePath`: la pantalla
 * es admin dinámica, así que "traer la verdad" es `router.refresh()` del cliente donde la tabla de consistencia
 * lo indica.
 */
import { requireUserId } from "@/auth";
import { isEnabled } from "@/lib/featureFlags";
import {
  addPreorderOffer, updatePreorderOffer, reorderPreorderOffers, setOfferOnCover,
  hidePreorderOffer, showPreorderOffer, cancelPreorderOffer, removeDraftPreorderOffer,
} from "@/lib/retail/offers";
import { setCampaignPrincipal, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { toStudioOfferRow, type StudioOfferRow } from "@/lib/retail/studio";
import { RetailError, RETAIL_ERROR, type RetailErrorCode } from "@/lib/domain/retail/errors";
import { StoreAuthError, type StoreAuthErrorCode } from "@/lib/domain/store/authorize";
import { retailErrorLabel } from "@/lib/retail/format";

export type StudioErrorCode = RetailErrorCode | StoreAuthErrorCode;

export type StudioActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: StudioErrorCode; message: string };

/** Mapea errores de DOMINIO a un resultado; re-lanza los demás (incl. "No autenticado") al error boundary. */
function fail(err: unknown): StudioActionResult<never> {
  if (err instanceof RetailError || err instanceof StoreAuthError)
    return { ok: false, code: err.code, message: retailErrorLabel(err.code) };
  throw err;
}
const disabled = (code: StudioErrorCode): StudioActionResult<never> => ({ ok: false, code, message: retailErrorLabel(code) });

// --- Inputs tipados (serializables; precios en CENTAVOS) --------------------------------------------------

export type AddOfferActionInput = { listPriceCents: number; preorderPriceCents: number } & (
  | { mode: "linked"; volumeId: number }
  | { mode: "manual"; descriptor: { title: string; volumeNumber: number | null; publisher: string | null; isbn: string | null } }
);

// --- Ofertas ----------------------------------------------------------------------------------------------

/** Agrega una oferta (linked del catálogo o manual gateada por flag). Devuelve la fila creada (append local). */
export async function addOfferAction(campaignId: number, input: AddOfferActionInput): Promise<StudioActionResult<StudioOfferRow>> {
  try {
    const userId = await requireUserId();
    if (input.mode === "manual" && !(await isEnabled("retail-manual-offers"))) return disabled(RETAIL_ERROR.FEATURE_DISABLED);
    const offer =
      input.mode === "linked"
        ? await addPreorderOffer({ campaignId, mode: "linked", volumeId: input.volumeId, listPriceCents: input.listPriceCents, preorderPriceCents: input.preorderPriceCents }, userId)
        : await addPreorderOffer({ campaignId, mode: "manual", descriptor: input.descriptor, listPriceCents: input.listPriceCents, preorderPriceCents: input.preorderPriceCents }, userId);
    return { ok: true, data: toStudioOfferRow(offer) };
  } catch (err) {
    return fail(err);
  }
}

/** Quita una oferta (solo DRAFT). Refresh: puede afectar principal/orden. */
export async function removeOfferAction(offerId: number): Promise<StudioActionResult<{ offerId: number }>> {
  try {
    const userId = await requireUserId();
    await removeDraftPreorderOffer(offerId, userId);
    return { ok: true, data: { offerId } };
  } catch (err) {
    return fail(err);
  }
}

/** Edita el precio de una oferta. Reconcile local. */
export async function updateOfferPriceAction(offerId: number, listPriceCents: number, preorderPriceCents: number): Promise<StudioActionResult<{ offerId: number; listPriceCents: number; preorderPriceCents: number }>> {
  try {
    const userId = await requireUserId();
    const offer = await updatePreorderOffer(offerId, { listPriceCents, preorderPriceCents }, userId);
    return { ok: true, data: { offerId: offer.id, listPriceCents: offer.listPriceCents, preorderPriceCents: offer.preorderPriceCents } };
  } catch (err) {
    return fail(err);
  }
}

/** Reordena el conjunto completo de ofertas de la campaña. Reconcile local. */
export async function reorderOffersAction(campaignId: number, orderedOfferIds: number[]): Promise<StudioActionResult<{ orderedOfferIds: number[] }>> {
  try {
    const userId = await requireUserId();
    await reorderPreorderOffers(campaignId, orderedOfferIds, userId);
    return { ok: true, data: { orderedOfferIds } };
  } catch (err) {
    return fail(err);
  }
}

/** Lleva/baja de portada. Devuelve el `principalOfferId` autoritativo (bajar la principal la limpia). Reconcile local. */
export async function setOnCoverAction(offerId: number, onCover: boolean): Promise<StudioActionResult<{ offerId: number; onCover: boolean; principalOfferId: number | null }>> {
  try {
    const userId = await requireUserId();
    const { offer, principalOfferId } = await setOfferOnCover(offerId, onCover, userId);
    return { ok: true, data: { offerId: offer.id, onCover: offer.onCover, principalOfferId } };
  } catch (err) {
    return fail(err);
  }
}

/** Elige o limpia la principal. Reconcile local. */
export async function setPrincipalAction(campaignId: number, offerId: number | null): Promise<StudioActionResult<{ principalOfferId: number | null }>> {
  try {
    const userId = await requireUserId();
    const campaign = await setCampaignPrincipal(campaignId, offerId, userId);
    return { ok: true, data: { principalOfferId: campaign.principalOfferId } };
  } catch (err) {
    return fail(err);
  }
}

/** Oculta una oferta. Devuelve estado + principal autoritativo (ocultar la principal la limpia). Refresh. */
export async function hideOfferAction(offerId: number): Promise<StudioActionResult<{ offerId: number; status: string; principalOfferId: number | null }>> {
  try {
    const userId = await requireUserId();
    const { offer, principalOfferId } = await hidePreorderOffer(offerId, userId);
    return { ok: true, data: { offerId: offer.id, status: offer.status, principalOfferId } };
  } catch (err) {
    return fail(err);
  }
}

/** Muestra una oferta oculta (vuelve a ACTIVE). Reconcile local. */
export async function showOfferAction(offerId: number): Promise<StudioActionResult<{ offerId: number; status: string }>> {
  try {
    const userId = await requireUserId();
    const { offer } = await showPreorderOffer(offerId, userId);
    return { ok: true, data: { offerId: offer.id, status: offer.status } };
  } catch (err) {
    return fail(err);
  }
}

/** Cancela una oferta (terminal). Devuelve estado + principal autoritativo (cancelar la principal la limpia). Refresh. */
export async function cancelOfferAction(offerId: number): Promise<StudioActionResult<{ offerId: number; status: string; principalOfferId: number | null }>> {
  try {
    const userId = await requireUserId();
    const { offer, principalOfferId } = await cancelPreorderOffer(offerId, userId);
    return { ok: true, data: { offerId: offer.id, status: offer.status, principalOfferId } };
  } catch (err) {
    return fail(err);
  }
}

// --- Campaña ----------------------------------------------------------------------------------------------

/** Publica la edición usando las precondiciones existentes (≥1 oferta ACTIVE, etc.). Refresh (cambia pantalla). */
export async function publishAction(campaignId: number): Promise<StudioActionResult<{ status: string; publishedAt: string | null }>> {
  try {
    const userId = await requireUserId();
    const campaign = await publishPreorderCampaign(campaignId, userId);
    return { ok: true, data: { status: campaign?.status ?? "PUBLISHED", publishedAt: campaign?.publishedAt ? campaign.publishedAt.toISOString() : null } };
  } catch (err) {
    return fail(err);
  }
}
