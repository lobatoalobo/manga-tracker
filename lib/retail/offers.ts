/**
 * Infra de Retail — servicio de PreorderOffer. Las ofertas se AGREGAN/EDITAN solo en campañas DRAFT;
 * OCULTAR/CANCELAR se permiten también tras PUBLICAR (§13). Toda operación lockea la campaña padre
 * (`FOR UPDATE`) para serializar con publish y con otras ediciones de oferta. El snapshot histórico se
 * resuelve desde Volume → PublisherEdition → Work al momento de agregar. `actorUserId` explícito.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STATUS, assertDraftEditable, type CampaignStatus } from "@/lib/domain/retail/campaign";
import { OFFER_STATUS, assertOfferTransition, assertValidPrices, assertValidManualDescriptor, buildReorderPlan, type OfferStatus, type ManualOfferDescriptor } from "@/lib/domain/retail/offer";
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

/** Descriptor manual que autora la tienda para un lanzamiento aún NO catalogado (sin Volume). */
export interface ManualOfferInput {
  title: string;
  volumeNumber?: number | null;
  publisher?: string | null;
  isbn?: string | null;
}

/**
 * Entrada de oferta DISCRIMINADA por `mode` (inequívoca y mutuamente excluyente: nunca ambos, nunca ninguno):
 *  - `linked`: exige `volumeId`; el snapshot se resuelve del catálogo (comportamiento histórico).
 *  - `manual`: exige `descriptor`; el snapshot se autora y `volumeId = null` (vínculo de catálogo diferido).
 */
export type AddOfferInput = {
  campaignId: number;
  listPriceCents: number;
  preorderPriceCents: number;
  sortOrder?: number;
} & (
  | { mode: "linked"; volumeId: number }
  | { mode: "manual"; descriptor: ManualOfferInput }
);

type OfferSnapshotFields = {
  titleSnapshot: string;
  volumeNumberSnapshot: number | null;
  publisherSnapshot: string | null;
  isbnSnapshot: string | null;
};

const manualToSnapshot = (d: ManualOfferDescriptor): OfferSnapshotFields => ({
  titleSnapshot: d.title,
  volumeNumberSnapshot: d.volumeNumber,
  publisherSnapshot: d.publisher,
  isbnSnapshot: d.isbn,
});

/**
 * Agrega una oferta a una campaña DRAFT. `linked` congela el snapshot desde el Volume (unicidad por Volume);
 * `manual` congela el snapshot autorado con `volumeId = null`. En ambos casos el snapshot es el registro
 * histórico inmutable de la descripción comercial publicada.
 */
export async function addPreorderOffer(input: AddOfferInput, actorUserId: string | null, client: Client = prisma) {
  // Validación pura del descriptor manual ANTES de abrir la tx (fail-fast, sin tocar catálogo).
  const manualSnapshot = input.mode === "manual" ? manualToSnapshot(assertValidManualDescriptor(input.descriptor)) : null;

  return client.$transaction(async (tx) => {
    const { storeId, status } = await lockCampaignOf(tx, input.campaignId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(status);
    assertValidPrices(input.listPriceCents, input.preorderPriceCents);

    let volumeId: number | null;
    let snapshot: OfferSnapshotFields;
    if (input.mode === "linked") {
      const v = await tx.volume.findUnique({
        where: { id: input.volumeId },
        select: { number: true, isbn: true, edition: { select: { title: true, publisher: true, work: { select: { title: true } } } } },
      });
      if (!v) throw new RetailError(RETAIL_ERROR.VOLUME_NOT_FOUND);
      volumeId = input.volumeId;
      snapshot = { titleSnapshot: v.edition.work?.title ?? v.edition.title, volumeNumberSnapshot: v.number, publisherSnapshot: v.edition.publisher, isbnSnapshot: v.isbn };
    } else {
      volumeId = null; // oferta manual: identidad de catálogo diferida
      snapshot = manualSnapshot!;
    }

    // Alta al FINAL del catálogo de la campaña (ADR-013): sin sortOrder explícito, va después del último. El
    // lock de la campaña (lockCampaignOf) serializa las altas concurrentes, así que el max no tiene carrera.
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const agg = await tx.preorderOffer.aggregate({ where: { campaignId: input.campaignId }, _max: { sortOrder: true } });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    try {
      return await tx.preorderOffer.create({
        data: {
          campaignId: input.campaignId,
          volumeId,
          ...snapshot,
          listPriceCents: input.listPriceCents,
          preorderPriceCents: input.preorderPriceCents,
          status: OFFER_STATUS.ACTIVE,
          sortOrder,
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

/**
 * REORDENA las ofertas de una campaña DRAFT (P-03 · Estudio). `orderedOfferIds` debe ser una PERMUTACIÓN
 * exacta de las ofertas de la campaña; `buildReorderPlan` (dominio puro) lo valida y produce `sortOrder =
 * índice`. Todo en una tx bajo el lock de campaña → serializa con publish y otras ediciones. Idempotente:
 * reordenar al mismo orden reescribe los mismos valores.
 */
export async function reorderPreorderOffers(campaignId: number, orderedOfferIds: number[], actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const { storeId, status } = await lockCampaignOf(tx, campaignId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(status);
    const existing = await tx.preorderOffer.findMany({ where: { campaignId }, select: { id: true } });
    const plan = buildReorderPlan(existing.map((o) => o.id), orderedOfferIds);
    for (const { offerId, sortOrder } of plan) {
      await tx.preorderOffer.update({ where: { id: offerId }, data: { sortOrder } });
    }
  });
}

/** Elimina una oferta solo si la campaña está en DRAFT (nunca borra ofertas históricas de publicadas). */
export async function removeDraftPreorderOffer(offerId: number, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const { offer, storeId, campaignStatus } = await loadOfferLocked(tx, offerId);
    await authorizeCampaignAction(tx, storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(campaignStatus);
    await tx.preorderOffer.delete({ where: { id: offer.id } });
  });
}
