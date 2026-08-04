/**
 * Infra de Retail — servicio de PreorderCampaign. Cada operación administrativa: (1) resuelve la entidad;
 * (2) deriva su `storeId`; (3) autoriza con `authorizeCampaignAction` (rol + requireEnabled de la política
 * central); (4) valida la transición/estado; (5) persiste. `actorUserId` explícito (la acción lo inyecta
 * desde la sesión). Concurrencia: las mutaciones lockean la fila de campaña (`FOR UPDATE`) y revalidan.
 */
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import {
  CAMPAIGN_STATUS,
  assertCampaignTransition,
  assertDraftEditable,
  assertValidTitle,
  assertValidDates,
  assertPublishable,
  type CampaignStatus,
} from "@/lib/domain/retail/campaign";
import { OFFER_STATUS, assertPrincipalEligible, type OfferStatus } from "@/lib/domain/retail/offer";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import { CAMPAIGN_ACTION } from "@/lib/domain/retail/policy";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { authorizeCampaignAction } from "@/lib/retail/auth";

type Client = PrismaClient;
type Tx = Pick<PrismaClient, "preorderCampaign" | "preorderOffer" | "storeCommerceProfile" | "storeMember" | "$queryRaw">;

export interface CreateCampaignInput {
  storeId: number;
  title: string;
  description?: string | null;
  weekLabel?: string | null;
  opensAt?: Date | null;
  closesAt?: Date | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Crea una campaña en DRAFT (autoriza CREATE por storeId). */
export async function createPreorderCampaign(input: CreateCampaignInput, actorUserId: string | null, client: Client = prisma) {
  await authorizeCampaignAction(client, input.storeId, actorUserId, CAMPAIGN_ACTION.CREATE);
  const title = assertValidTitle(input.title);
  assertValidDates(input.opensAt ?? null, input.closesAt ?? null);
  return client.preorderCampaign.create({
    data: {
      storeId: input.storeId,
      title,
      description: clean(input.description),
      weekLabel: clean(input.weekLabel),
      status: CAMPAIGN_STATUS.DRAFT,
      opensAt: input.opensAt ?? null,
      closesAt: input.closesAt ?? null,
      createdByUserId: actorUserId,
    },
  });
}

/** Carga + BLOQUEA la campaña (FOR UPDATE) dentro de una tx; null si no existe. */
async function lockCampaign(tx: Tx, campaignId: number) {
  await tx.$queryRaw`SELECT id FROM "PreorderCampaign" WHERE id = ${campaignId} FOR UPDATE`;
  return tx.preorderCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true, storeId: true, status: true, title: true, opensAt: true, closesAt: true, publishedAt: true },
  });
}

function requireCampaign<T>(c: T | null): T {
  if (!c) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  return c;
}

export interface UpdateCampaignPatch {
  title?: string;
  description?: string | null;
  weekLabel?: string | null;
  opensAt?: Date | null;
  closesAt?: Date | null;
}

/**
 * Edita una campaña respetando la mutabilidad por estado (§13): en DRAFT se edita todo; en PUBLISHED SOLO
 * la descripción; en CLOSED/CANCELLED nada. Los campos comerciales (título/fechas) quedan protegidos tras publicar.
 */
export async function updateCampaign(campaignId: number, patch: UpdateCampaignPatch, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const c = requireCampaign(await lockCampaign(tx, campaignId));
    await authorizeCampaignAction(tx, c.storeId, actorUserId, CAMPAIGN_ACTION.EDIT_DRAFT);
    const status = c.status as CampaignStatus;

    if (status === CAMPAIGN_STATUS.DRAFT) {
      const data: Record<string, unknown> = {};
      if (patch.title !== undefined) data.title = assertValidTitle(patch.title);
      if (patch.description !== undefined) data.description = clean(patch.description);
      if (patch.weekLabel !== undefined) data.weekLabel = clean(patch.weekLabel);
      if (patch.opensAt !== undefined) data.opensAt = patch.opensAt;
      if (patch.closesAt !== undefined) data.closesAt = patch.closesAt;
      const opensAt = patch.opensAt !== undefined ? patch.opensAt : c.opensAt;
      const closesAt = patch.closesAt !== undefined ? patch.closesAt : c.closesAt;
      assertValidDates(opensAt, closesAt);
      return tx.preorderCampaign.update({ where: { id: campaignId }, data });
    }
    if (status === CAMPAIGN_STATUS.PUBLISHED) {
      // Solo la descripción pública; el resto está congelado tras publicar.
      if (patch.title !== undefined || patch.weekLabel !== undefined || patch.opensAt !== undefined || patch.closesAt !== undefined)
        throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE, "tras publicar solo se edita la descripción");
      return tx.preorderCampaign.update({ where: { id: campaignId }, data: { description: clean(patch.description) } });
    }
    throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE, `campaña en estado ${status}`);
  });
}

/**
 * Elige o limpia la oferta PRINCIPAL de la portada (P-03 · Estudio). Solo DRAFT. `offerId = null` limpia.
 * `offerId != null` exige (vía `assertPrincipalEligible`) que la oferta sea de la campaña, ACTIVE y en portada
 * (si no, error específico). Idempotente. NO auto-elige otra al limpiar (D-008).
 */
export async function setCampaignPrincipal(campaignId: number, offerId: number | null, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const c = requireCampaign(await lockCampaign(tx, campaignId));
    await authorizeCampaignAction(tx, c.storeId, actorUserId, CAMPAIGN_ACTION.MANAGE_OFFERS);
    assertDraftEditable(c.status as CampaignStatus);
    if (offerId === null)
      return tx.preorderCampaign.update({ where: { id: campaignId }, data: { principalOfferId: null } });
    const offer = await tx.preorderOffer.findUnique({ where: { id: offerId }, select: { campaignId: true, status: true, onCover: true } });
    if (!offer) throw new RetailError(RETAIL_ERROR.OFFER_NOT_FOUND);
    assertPrincipalEligible({ campaignId: offer.campaignId, status: offer.status as OfferStatus, onCover: offer.onCover }, campaignId);
    return tx.preorderCampaign.update({ where: { id: campaignId }, data: { principalOfferId: offerId } });
  });
}

/**
 * PUBLICA una campaña DRAFT (transaccional, bajo lock). Idempotente si ya está PUBLISHED. Valida
 * habilitación, título, fechas y ≥1 oferta ACTIVE (§12). Registra `publishedAt`.
 */
export async function publishPreorderCampaign(campaignId: number, actorUserId: string | null, client: Client = prisma, now: Date = new Date()) {
  return client.$transaction(async (tx) => {
    const c = requireCampaign(await lockCampaign(tx, campaignId));
    const ctx = await authorizeCampaignAction(tx, c.storeId, actorUserId, CAMPAIGN_ACTION.PUBLISH);
    const status = c.status as CampaignStatus;

    if (status === CAMPAIGN_STATUS.PUBLISHED) return tx.preorderCampaign.findUnique({ where: { id: campaignId } }); // idempotente
    assertCampaignTransition(status, CAMPAIGN_STATUS.PUBLISHED);

    const activeOfferCount = await tx.preorderOffer.count({ where: { campaignId, status: OFFER_STATUS.ACTIVE } });
    assertPublishable({ title: c.title, opensAt: c.opensAt, closesAt: c.closesAt, storeEnabled: ctx.profile.enabled, activeOfferCount });

    return tx.preorderCampaign.update({ where: { id: campaignId }, data: { status: CAMPAIGN_STATUS.PUBLISHED, publishedAt: now } });
  });
}

/** CIERRA una campaña PUBLISHED (impide operaciones futuras). Idempotente si ya CLOSED. */
export async function closePreorderCampaign(campaignId: number, actorUserId: string | null, client: Client = prisma, now: Date = new Date()) {
  return client.$transaction(async (tx) => {
    const c = requireCampaign(await lockCampaign(tx, campaignId));
    await authorizeCampaignAction(tx, c.storeId, actorUserId, CAMPAIGN_ACTION.CLOSE);
    const status = c.status as CampaignStatus;
    if (status === CAMPAIGN_STATUS.CLOSED) return tx.preorderCampaign.findUnique({ where: { id: campaignId } }); // idempotente
    assertCampaignTransition(status, CAMPAIGN_STATUS.CLOSED);
    return tx.preorderCampaign.update({ where: { id: campaignId }, data: { status: CAMPAIGN_STATUS.CLOSED, closedAt: now } });
  });
}

/**
 * CANCELA una campaña (conserva historial). Idempotente si ya CANCELLED. §18: NO se puede cancelar una
 * campaña con órdenes activas (RESERVED) — la tienda debe resolver primero esas órdenes/líneas; sin órdenes
 * activas, cancela normalmente. No hace cancelación masiva automática.
 */
export async function cancelPreorderCampaign(campaignId: number, actorUserId: string | null, client: Client = prisma, now: Date = new Date()) {
  return client.$transaction(async (tx) => {
    const c = requireCampaign(await lockCampaign(tx, campaignId));
    await authorizeCampaignAction(tx, c.storeId, actorUserId, CAMPAIGN_ACTION.CANCEL);
    const status = c.status as CampaignStatus;
    if (status === CAMPAIGN_STATUS.CANCELLED) return tx.preorderCampaign.findUnique({ where: { id: campaignId } }); // idempotente
    assertCampaignTransition(status, CAMPAIGN_STATUS.CANCELLED);
    const activeOrders = await tx.storeOrder.count({ where: { campaignId, status: { not: ORDER_STATUS.CANCELLED } } });
    if (activeOrders > 0) throw new RetailError(RETAIL_ERROR.CAMPAIGN_HAS_ACTIVE_ORDERS, "la campaña tiene órdenes activas; cancelalas primero");
    return tx.preorderCampaign.update({ where: { id: campaignId }, data: { status: CAMPAIGN_STATUS.CANCELLED, closedAt: now } });
  });
}

/** Elimina una campaña DRAFT sin actividad (cascada sus ofertas). Solo DRAFT (nunca hard-delete publicadas). */
export async function removeDraftPreorderCampaign(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  return client.$transaction(async (tx) => {
    const c = requireCampaign(await lockCampaign(tx, campaignId));
    await authorizeCampaignAction(tx, c.storeId, actorUserId, CAMPAIGN_ACTION.DELETE_DRAFT);
    if ((c.status as CampaignStatus) !== CAMPAIGN_STATUS.DRAFT)
      throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE, "solo se pueden eliminar borradores");
    await tx.preorderCampaign.delete({ where: { id: campaignId } });
  });
}

/** Panel de la tienda: campañas de UN store (autoriza como miembro; no exige habilitada). */
export async function listStoreCampaigns(storeId: number, actorUserId: string | null, client: Client = prisma) {
  await authorizeCampaignAction(client, storeId, actorUserId, CAMPAIGN_ACTION.CLOSE); // [OWNER,STAFF], requireEnabled:false = vista de miembro
  return client.preorderCampaign.findMany({
    where: { storeId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, title: true, status: true, weekLabel: true, opensAt: true, closesAt: true, publishedAt: true, createdAt: true, _count: { select: { offers: true } } },
  });
}

/** Campaña de la tienda con sus ofertas, para el detalle admin (autoriza como miembro). */
export async function getStoreCampaign(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const c = await client.preorderCampaign.findUnique({ where: { id: campaignId }, include: { offers: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
  if (!c) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeCampaignAction(client, c.storeId, actorUserId, CAMPAIGN_ACTION.CLOSE); // vista de miembro
  return c;
}
