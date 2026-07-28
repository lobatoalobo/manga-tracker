/**
 * Infra de Retail — servicio de StoreOrder / reservas (Slice 3). Session-free: recibe `actorUserId`
 * EXPLÍCITO (la acción web lo obtiene de la sesión) y jamás confía en storeId/slug/precios del cliente.
 *
 * Creación: transaccional, bajo lock de la campaña. Valida DENTRO de la tx (campaña abierta, ofertas de la
 * campaña y activas, cantidades, precios) y calcula totales en el servidor desde los precios de la oferta.
 * Idempotencia natural por `@@unique([campaignId, userId])`: un doble submit del mismo usuario devuelve su
 * orden RESERVED existente; una campaña ya reservada y luego cancelada NO se re-reserva en esta slice.
 *
 * Lecturas/cancelaciones: el `publicCode` NO autoriza; el cliente solo ve/cancela órdenes con
 * `userId === actor`, y la tienda solo las de su propio `storeId` (derivado de la orden, con membresía).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeStoreAccess } from "@/lib/storeAccess";
import { STORE_ROLE, StoreAuthError, STORE_AUTH_ERROR } from "@/lib/domain/store/authorize";
import { isCampaignOpen, type CampaignStatus } from "@/lib/domain/retail/campaign";
import { OFFER_STATUS } from "@/lib/domain/retail/offer";
import {
  ORDER_STATUS,
  consolidateRequestedLines,
  computeLineTotalCents,
  computeOrderTotalCents,
  assertExpectedTotal,
  assertCustomerCancellable,
  assertStoreCancellable,
  type OrderStatus,
  type RequestedLine,
} from "@/lib/domain/retail/order";
import { LINE_EVENT_TYPE, deriveFulfillmentStatus, assertNoFulfillmentStarted, pendingQuantity } from "@/lib/domain/retail/fulfillment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { generatePublicCode } from "@/lib/retail/publicCode";
import { randomUUID } from "node:crypto";

type Client = PrismaClient;

const STORE_ROLES = [STORE_ROLE.OWNER, STORE_ROLE.STAFF] as const;
const CREATE_MAX_ATTEMPTS = 5; // reintentos ante colisión (astronómica) de publicCode

function requireActor(actorUserId: string | null): string {
  if (!actorUserId) throw new StoreAuthError(STORE_AUTH_ERROR.UNAUTHENTICATED);
  return actorUserId;
}

/** ¿La violación de unicidad P2002 apunta al campo `field`? (target puede ser array de columnas o el nombre). */
function isUniqueViolationOn(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === "string" && target.includes(field);
}

export interface CreateOrderInput {
  campaignId: number;
  items: RequestedLine[];
  /** Total que el cliente CREE reservar; solo se compara con el del servidor (nunca se persiste). */
  expectedTotalCents?: number | null;
}

/**
 * Crea (o devuelve, si ya existe RESERVED) la reserva del usuario para la campaña. Toda la validación y el
 * cálculo de totales ocurren DENTRO de la transacción que crea la orden — nunca se confía en datos validados
 * antes de la tx. Reintenta la tx completa solo si colisiona el `publicCode`.
 */
export async function createStoreOrder(input: CreateOrderInput, actorUserId: string | null, client: Client = prisma, now: Date = new Date()) {
  const userId = requireActor(actorUserId);
  const consolidated = consolidateRequestedLines(input.items); // rechaza vacío / cantidades inválidas (fuera de tx: pura)

  let lastErr: unknown;
  for (let attempt = 0; attempt < CREATE_MAX_ATTEMPTS; attempt++) {
    try {
      return await client.$transaction(async (tx) => {
        // 1. Lock de la campaña: serializa creación/cierre/otras reservas sobre la misma campaña.
        await tx.$queryRaw`SELECT id FROM "PreorderCampaign" WHERE id = ${input.campaignId} FOR UPDATE`;
        const campaign = await tx.preorderCampaign.findUnique({
          where: { id: input.campaignId },
          select: { id: true, storeId: true, status: true, opensAt: true, closesAt: true },
        });
        if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);

        // 2. Comercio habilitado (dentro de la tx).
        const profile = await tx.storeCommerceProfile.findUnique({ where: { storeId: campaign.storeId }, select: { enabled: true, slug: true } });
        if (!profile || !profile.enabled) throw new RetailError(RETAIL_ERROR.STORE_COMMERCE_DISABLED);

        // 3. Campaña abierta (política temporal pura, `now` inyectado).
        if (!isCampaignOpen({ status: campaign.status as CampaignStatus, opensAt: campaign.opensAt, closesAt: campaign.closesAt, storeEnabled: true }, now))
          throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_OPEN);

        // 4. Idempotencia por (campaignId, userId): una sola orden por usuario/campaña.
        const existing = await tx.storeOrder.findUnique({
          where: { campaignId_userId: { campaignId: input.campaignId, userId } },
          include: { lines: { orderBy: { id: "asc" } } },
        });
        if (existing) {
          if (existing.status === ORDER_STATUS.RESERVED) return existing; // doble submit → misma orden (inmutable)
          throw new RetailError(RETAIL_ERROR.ORDER_ALREADY_EXISTS, "ya reservaste esta campaña (cancelar es definitivo)");
        }

        // 5. Cargar ofertas DENTRO de la tx; validar pertenencia y disponibilidad; congelar precios/snapshots.
        const offerIds = [...consolidated.keys()];
        const offers = await tx.preorderOffer.findMany({
          where: { id: { in: offerIds } },
          select: { id: true, campaignId: true, status: true, volumeId: true, listPriceCents: true, preorderPriceCents: true, titleSnapshot: true, volumeNumberSnapshot: true, publisherSnapshot: true, isbnSnapshot: true },
        });
        const byId = new Map(offers.map((o) => [o.id, o]));

        const lineTotals: number[] = [];
        const lineData = offerIds.map((offerId) => {
          const o = byId.get(offerId);
          if (!o) throw new RetailError(RETAIL_ERROR.OFFER_NOT_AVAILABLE, "la oferta no existe");
          if (o.campaignId !== input.campaignId) throw new RetailError(RETAIL_ERROR.OFFER_CAMPAIGN_MISMATCH, "la oferta no es de esta campaña");
          if (o.status !== OFFER_STATUS.ACTIVE) throw new RetailError(RETAIL_ERROR.OFFER_NOT_AVAILABLE, "la oferta no está disponible");
          const quantity = consolidated.get(offerId)!;
          const lineTotalCents = computeLineTotalCents(o.preorderPriceCents, quantity);
          lineTotals.push(lineTotalCents);
          return {
            offerId,
            volumeId: o.volumeId,
            quantity,
            unitListPriceCents: o.listPriceCents,
            unitPreorderPriceCents: o.preorderPriceCents,
            lineTotalCents,
            titleSnapshot: o.titleSnapshot,
            volumeNumberSnapshot: o.volumeNumberSnapshot,
            publisherSnapshot: o.publisherSnapshot,
            isbnSnapshot: o.isbnSnapshot,
          };
        });
        const totalCents = computeOrderTotalCents(lineTotals);
        assertExpectedTotal(input.expectedTotalCents, totalCents); // rechaza total manipulado por el cliente

        // 6. Snapshot mínimo del cliente (lo que la tienda necesita para cumplir; sin inventar PII).
        const customer = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

        // 7. Crear orden + líneas en UNA operación (nested create) → atómico, sin órdenes parciales.
        return tx.storeOrder.create({
          data: {
            publicCode: generatePublicCode(profile.slug),
            storeId: campaign.storeId,
            campaignId: input.campaignId,
            userId,
            status: ORDER_STATUS.RESERVED,
            customerNameSnapshot: customer?.name ?? null,
            customerEmailSnapshot: customer?.email ?? null,
            totalCents,
            lines: { create: lineData },
          },
          include: { lines: { orderBy: { id: "asc" } } },
        });
      });
    } catch (err) {
      if (isUniqueViolationOn(err, "publicCode")) { lastErr = err; continue; } // regenerar código y reintentar la tx
      if (isUniqueViolationOn(err, "userId") || isUniqueViolationOn(err, "campaignId"))
        throw new RetailError(RETAIL_ERROR.ORDER_ALREADY_EXISTS, "ya tenés una orden para esta campaña"); // carrera perdida
      throw err;
    }
  }
  throw lastErr ?? new RetailError(RETAIL_ERROR.ORDER_ALREADY_EXISTS);
}

// --- Lecturas / cancelación de CLIENTE ------------------------------------------------------------------

const ORDER_LINE_SELECT = {
  id: true, offerId: true, volumeId: true, quantity: true, unitListPriceCents: true, unitPreorderPriceCents: true,
  lineTotalCents: true, titleSnapshot: true, volumeNumberSnapshot: true, publisherSnapshot: true, isbnSnapshot: true,
  // Cumplimiento (Slice 4): el cliente y la tienda ven el estado operativo por línea.
  fulfillmentStatus: true, orderedQuantity: true, arrivedQuantity: true, cancelledQuantity: true,
  orderedAt: true, arrivedAt: true, cancelledAt: true,
} as const;

/**
 * Cancela una orden COMPLETA (uso interno, bajo lock): exige que ninguna línea tenga operación física
 * iniciada (§12) y luego cancela todas sus líneas por completo, registrando un evento por línea. Devuelve la
 * orden actualizada. `who` es el actor (cliente o miembro) para la auditoría.
 */
async function cancelWholeOrder(
  tx: Pick<PrismaClient, "storeOrderLine" | "storeOrderLineEvent" | "storeOrder" | "storeOrderNotification">,
  orderId: number, who: string, reason: string | null, now: Date,
) {
  const lines = await tx.storeOrderLine.findMany({
    where: { orderId },
    select: { id: true, quantity: true, orderedQuantity: true, arrivedQuantity: true, cancelledQuantity: true, cancelledAt: true },
  });
  assertNoFulfillmentStarted(lines); // rechaza si ya se pidió/llegó algo → ORDER_FULFILLMENT_STARTED
  // §15: los avisos DRAFT (aún no enviados) se cancelan automáticamente; los SENT se conservan (historial).
  await tx.storeOrderNotification.updateMany({ where: { orderId, status: "DRAFT" }, data: { status: "CANCELLED", cancelledAt: now } });
  const trimmed = reason?.trim()?.slice(0, 280) || null;
  for (const l of lines) {
    const pending = pendingQuantity(l);
    if (pending <= 0) continue; // ya terminal (defensivo: no debería pasar sin fulfillment iniciado)
    const cancelledQuantity = l.cancelledQuantity + pending;
    const next = { quantity: l.quantity, orderedQuantity: l.orderedQuantity, arrivedQuantity: l.arrivedQuantity, cancelledQuantity };
    await tx.storeOrderLine.update({
      where: { id: l.id },
      data: {
        cancelledQuantity, fulfillmentStatus: deriveFulfillmentStatus(next),
        cancelledAt: l.cancelledAt ?? now, cancelledBy: { connect: { id: who } }, cancellationReason: trimmed,
      },
    });
    await tx.storeOrderLineEvent.create({
      data: { orderLineId: l.id, type: LINE_EVENT_TYPE.CANCELLED, quantity: pending, actorUserId: who, operationKey: randomUUID(), note: trimmed },
    });
  }
  return tx.storeOrder.update({
    where: { id: orderId },
    data: { status: ORDER_STATUS.CANCELLED, cancelledAt: now, cancelledByUserId: who, cancellationReason: trimmed },
  });
}

/** Lista las órdenes del cliente (las suyas). Datos mínimos + tienda/campaña + conteo de unidades. */
export async function listCustomerOrders(actorUserId: string | null, client: Client = prisma) {
  const userId = requireActor(actorUserId);
  return client.storeOrder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, publicCode: true, status: true, totalCents: true, createdAt: true,
      store: { select: { name: true } },
      campaign: { select: { id: true, title: true, weekLabel: true } },
      _count: { select: { lines: true } },
    },
  });
}

/** Detalle de UNA orden del cliente por `publicCode`. Verifica propiedad (el código no autoriza). */
export async function getCustomerOrder(publicCode: string, actorUserId: string | null, client: Client = prisma) {
  const userId = requireActor(actorUserId);
  const order = await client.storeOrder.findUnique({
    where: { publicCode },
    select: {
      id: true, publicCode: true, userId: true, status: true, totalCents: true, createdAt: true, cancelledAt: true,
      store: { select: { name: true, commerceProfile: { select: { slug: true } } } },
      campaign: { select: { id: true, title: true, weekLabel: true, status: true, opensAt: true, closesAt: true } },
      lines: { orderBy: { id: "asc" }, select: ORDER_LINE_SELECT },
      // Avisos SENT visibles al cliente (§21): fecha, mensaje e ítems. Nunca DRAFT/CANCELLED ni datos internos.
      notifications: {
        where: { status: "SENT" },
        orderBy: { sentAt: "desc" },
        select: { id: true, messageSnapshot: true, sentAt: true, items: { select: { quantity: true, orderLine: { select: { titleSnapshot: true, volumeNumberSnapshot: true } } } } },
      },
    },
  });
  if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
  if (order.userId !== userId) throw new RetailError(RETAIL_ERROR.ORDER_ACCESS_DENIED);
  return order;
}

/** Bloquea la fila de orden (FOR UPDATE) y devuelve su estado + storeId + datos de campaña, o lanza. */
async function lockOrder(tx: Pick<PrismaClient, "$queryRaw" | "storeOrder">, orderId: number) {
  await tx.$queryRaw`SELECT id FROM "StoreOrder" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.storeOrder.findUnique({
    where: { id: orderId },
    select: { id: true, storeId: true, userId: true, status: true, campaign: { select: { status: true, opensAt: true, closesAt: true, store: { select: { commerceProfile: { select: { enabled: true } } } } } } },
  });
  if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
  return order;
}

/** El cliente cancela su propia orden RESERVED mientras la campaña siga abierta. */
export async function cancelCustomerOrder(publicCode: string, actorUserId: string | null, client: Client = prisma, now: Date = new Date()) {
  const userId = requireActor(actorUserId);
  return client.$transaction(async (tx) => {
    const found = await tx.storeOrder.findUnique({ where: { publicCode }, select: { id: true } });
    if (!found) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
    const order = await lockOrder(tx, found.id);
    if (order.userId !== userId) throw new RetailError(RETAIL_ERROR.ORDER_ACCESS_DENIED);
    const campaignOpen = isCampaignOpen(
      { status: order.campaign.status as CampaignStatus, opensAt: order.campaign.opensAt, closesAt: order.campaign.closesAt, storeEnabled: !!order.campaign.store.commerceProfile?.enabled },
      now,
    );
    assertCustomerCancellable(order.status as OrderStatus, campaignOpen);
    // §12: el cliente solo cancela si NINGUNA unidad se pidió/llegó (lo valida cancelWholeOrder).
    return cancelWholeOrder(tx, order.id, userId, null, now);
  });
}

// --- Lecturas / cancelación de TIENDA (OWNER/STAFF) -----------------------------------------------------

/** Autoriza a un miembro (OWNER/STAFF) sobre el `storeId`; requireEnabled:false (puede operar deshabilitada). */
function authorizeStoreOrderAccess(client: Pick<PrismaClient, "storeCommerceProfile" | "storeMember">, storeId: number, actorUserId: string | null) {
  return authorizeStoreAccess(client, { storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
}

/** Órdenes de una campaña, para el panel de la tienda. Autoriza por storeId derivado de la campaña. */
export async function listStoreOrders(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const campaign = await client.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true, storeId: true, title: true } });
  if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeStoreOrderAccess(client, campaign.storeId, actorUserId);
  const orders = await client.storeOrder.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, publicCode: true, status: true, totalCents: true, createdAt: true,
      customerNameSnapshot: true, customerEmailSnapshot: true,
      lines: { select: { quantity: true } },
    },
  });
  return {
    campaign,
    orders: orders.map((o) => ({
      id: o.id, publicCode: o.publicCode, status: o.status, totalCents: o.totalCents, createdAt: o.createdAt,
      customerName: o.customerNameSnapshot, customerEmail: o.customerEmailSnapshot,
      lineCount: o.lines.length, units: o.lines.reduce((s, l) => s + l.quantity, 0),
    })),
  };
}

/** Detalle de UNA orden para la tienda. Autoriza por storeId de la propia orden (no por slug del cliente). */
export async function getStoreOrder(orderId: number, actorUserId: string | null, client: Client = prisma) {
  const order = await client.storeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, publicCode: true, storeId: true, status: true, totalCents: true, createdAt: true, cancelledAt: true, cancellationReason: true,
      customerNameSnapshot: true, customerEmailSnapshot: true,
      campaign: { select: { id: true, title: true, weekLabel: true, status: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          ...ORDER_LINE_SELECT,
          cancellationReason: true,
          events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, type: true, quantity: true, actorUserId: true, note: true, createdAt: true } },
        },
      },
    },
  });
  if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
  await authorizeStoreOrderAccess(client, order.storeId, actorUserId);
  return order;
}

/** La tienda (OWNER/STAFF) cancela una orden RESERVED. Registra quién y por qué (auditoría mínima). */
export async function cancelStoreOrder(orderId: number, actorUserId: string | null, reason: string | null = null, client: Client = prisma, now: Date = new Date()) {
  const actor = requireActor(actorUserId);
  return client.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    await authorizeStoreOrderAccess(tx, order.storeId, actor);
    assertStoreCancellable(order.status as OrderStatus);
    // §12 (MVP seguro): rechaza si la operación física ya comenzó; la tienda debe cancelar las líneas antes.
    return cancelWholeOrder(tx, order.id, actor, reason, now);
  });
}
