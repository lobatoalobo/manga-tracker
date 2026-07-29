/**
 * Infra de Retail — servicio de PreorderOffer. Las ofertas se AGREGAN/EDITAN solo en campañas DRAFT;
 * OCULTAR/CANCELAR se permiten también tras PUBLICAR (§13). Toda operación lockea la campaña padre
 * (`FOR UPDATE`) para serializar con publish y con otras ediciones de oferta. El snapshot histórico se
 * resuelve desde Volume → PublisherEdition → Work al momento de agregar. `actorUserId` explícito.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STATUS, assertDraftEditable, type CampaignStatus } from "@/lib/domain/retail/campaign";
import { OFFER_STATUS, assertOfferTransition, assertValidPrices, type OfferStatus } from "@/lib/domain/retail/offer";
import { CAMPAIGN_ACTION } from "@/lib/domain/retail/policy";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { authorizeCampaignAction } from "@/lib/retail/auth";

type Client = PrismaClient;
type Tx = Pick<PrismaClient, "preorderCampaign" | "preorderOffer" | "volume" | "storeCommerceProfile" | "storeMember" | "$queryRaw">;

/** Lockea la campaña padre y devuelve su estado + storeId (o lanza CAMPAIGN_NOT_FOUND). */
async function lockCampaignOf(tx: Tx, campaignId: number): Promise<{ storeId: number; status: CampaignStatus }> {
  await tx.$queryRaw`SELECT id FROM "PreorderCampaign" WHERE id = ${campaignId} FOR UPDATE`;
  const c = await tx.preorderCampaign.findUnique({ where: { id: campaignId }, select: { storeId: true, status: true } });
  if (!c) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  return { storeId: c.storeId, status: c.status as CampaignStatus };
}

export interface AddOfferInput {
  campaignId: number;
  volumeId: number;
  listPriceCents: number;
  preorderPriceCents: number;
  sortOrder?: number;
}

/** Agrega un tomo real como oferta (solo en DRAFT). Snapshot resuelto del catálogo. Unicidad por Volume. */
export async function addPreorderOffer(input: AddOfferInput, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const { storeId, status } = await lockCampaignOf(tx, input.campaignId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(status);
    assertValidPrices(input.listPriceCents, input.preorderPriceCents);

    const v = await tx.volume.findUnique({
      where: { id: input.volumeId },
      select: { number: true, isbn: true, edition: { select: { title: true, publisher: true, work: { select: { title: true } } } } },
    });
    if (!v) throw new RetailError(RETAIL_ERROR.VOLUME_NOT_FOUND);

    try {
      return await tx.preorderOffer.create({
        data: {
          campaignId: input.campaignId,
          volumeId: input.volumeId,
          titleSnapshot: v.edition.work?.title ?? v.edition.title,
          volumeNumberSnapshot: v.number,
          publisherSnapshot: v.edition.publisher,
          isbnSnapshot: v.isbn,
          listPriceCents: input.listPriceCents,
          preorderPriceCents: input.preorderPriceCents,
          status: OFFER_STATUS.ACTIVE,
          sortOrder: input.sortOrder ?? 0,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new RetailError(RETAIL_ERROR.OFFER_ALREADY_EXISTS, "ese tomo ya está en la campaña");
      throw err;
    }
  });
}

/** Carga la oferta + su campaña bloqueada; valida que pertenezca a esa campaña (no confía en ids sueltos). */
async function loadOfferLocked(tx: Tx, offerId: number) {
  const offer = await tx.preorderOffer.findUnique({ where: { id: offerId }, select: { id: true, campaignId: true, status: true, listPriceCents: true, preorderPriceCents: true } });
  if (!offer) throw new RetailError(RETAIL_ERROR.OFFER_NOT_FOUND);
  const { storeId, status } = await lockCampaignOf(tx, offer.campaignId);
  return { offer, storeId, campaignStatus: status };
}

export interface UpdateOfferPatch {
  listPriceCents?: number;
  preorderPriceCents?: number;
  sortOrder?: number;
}

/** Edita precios/orden de una oferta. Solo en DRAFT (precios congelados tras publicar, §13). */
export async function updatePreorderOffer(offerId: number, patch: UpdateOfferPatch, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const { offer, storeId, campaignStatus } = await loadOfferLocked(tx, offerId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(campaignStatus);
    const list = patch.listPriceCents ?? offer.listPriceCents;
    const preorder = patch.preorderPriceCents ?? offer.preorderPriceCents;
    assertValidPrices(list, preorder);
    return tx.preorderOffer.update({
      where: { id: offerId },
      data: {
        ...(patch.listPriceCents !== undefined ? { listPriceCents: patch.listPriceCents } : {}),
        ...(patch.preorderPriceCents !== undefined ? { preorderPriceCents: patch.preorderPriceCents } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      },
    });
  });
}

/** Transición de estado de una oferta (ocultar/mostrar/cancelar). Permitida en DRAFT o PUBLISHED. */
async function setOfferStatus(offerId: number, target: OfferStatus, actorUserId: string | null, client: Client) {
  return client.$transaction(async (tx) => {
    const { offer, storeId, campaignStatus } = await loadOfferLocked(tx, offerId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    if (campaignStatus === CAMPAIGN_STATUS.CLOSED || campaignStatus === CAMPAIGN_STATUS.CANCELLED)
      throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE, `campaña en estado ${campaignStatus}`);
    if ((offer.status as OfferStatus) === target) return tx.preorderOffer.findUnique({ where: { id: offerId } }); // idempotente
    assertOfferTransition(offer.status as OfferStatus, target);
    return tx.preorderOffer.update({ where: { id: offerId }, data: { status: target } });
  });
}

export const hidePreorderOffer = (offerId: number, actor: string | null, client: Client = prisma) => setOfferStatus(offerId, OFFER_STATUS.HIDDEN, actor, client);
export const showPreorderOffer = (offerId: number, actor: string | null, client: Client = prisma) => setOfferStatus(offerId, OFFER_STATUS.ACTIVE, actor, client);
export const cancelPreorderOffer = (offerId: number, actor: string | null, client: Client = prisma) => setOfferStatus(offerId, OFFER_STATUS.CANCELLED, actor, client);

/** Elimina una oferta solo si la campaña está en DRAFT (nunca borra ofertas históricas de publicadas). */
export async function removeDraftPreorderOffer(offerId: number, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const { offer, storeId, campaignStatus } = await loadOfferLocked(tx, offerId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(campaignStatus);
    await tx.preorderOffer.delete({ where: { id: offer.id } });
  });
}
