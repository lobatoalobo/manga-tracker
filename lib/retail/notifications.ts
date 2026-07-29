/**
 * Infra de Retail / Avisos de llegada (Slice 5). Session-free (`actorUserId` explícito). Toda operación
 * deriva la tienda/orden desde la notificación o la línea (nunca confía en storeId/slug/ids del cliente) y
 * autoriza OWNER/STAFF con `requireEnabled:false` (la comunicación histórica continúa con el comercio
 * deshabilitado). El envío es MANUAL: no se manda nada por fuera; solo se registra que la tienda avisó.
 *
 * "Informado" se DERIVA de los ítems de avisos SENT (no hay contador en la línea). La validación definitiva
 * de disponibilidad ocurre al ENVIAR, dentro de la transacción, tras bloquear orden y líneas.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeStoreAccess } from "@/lib/storeAccess";
import { STORE_ROLE } from "@/lib/domain/store/authorize";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import {
  NOTIFICATION_STATUS, NOTIFICATION_TYPE,
  assertNotificationEditable, assertValidSelection, assertNonEmptyMessage,
  buildArrivalMessage, unnotifiedArrivalQuantity, reconcileSendKey, type SelectionItem, type NotificationStatus,
} from "@/lib/domain/retail/notification";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

type Client = PrismaClient;
const STORE_ROLES = [STORE_ROLE.OWNER, STORE_ROLE.STAFF] as const;

function isUniqueViolationOn(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === "string" && target.includes(field);
}

/** Suma, por línea, las unidades ya informadas (ítems de avisos ARRIVAL SENT) de una orden. */
async function notifiedByLine(client: Pick<PrismaClient, "storeOrderNotificationItem">, orderId: number): Promise<Map<number, number>> {
  const items = await client.storeOrderNotificationItem.findMany({
    where: { notification: { orderId, type: NOTIFICATION_TYPE.ARRIVAL, status: NOTIFICATION_STATUS.SENT } },
    select: { orderLineId: true, quantity: true },
  });
  const m = new Map<number, number>();
  for (const it of items) m.set(it.orderLineId, (m.get(it.orderLineId) ?? 0) + it.quantity);
  return m;
}

async function loadOrderForNotify(client: Client, orderId: number) {
  const order = await client.storeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, storeId: true, status: true, publicCode: true, customerNameSnapshot: true, customerEmailSnapshot: true,
      store: { select: { name: true } },
      lines: { orderBy: { id: "asc" }, select: { id: true, titleSnapshot: true, volumeNumberSnapshot: true, arrivedQuantity: true } },
    },
  });
  if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
  return order;
}

export interface ArrivalPreviewLine {
  orderLineId: number; title: string; volumeNumber: number | null; arrivedQuantity: number; notifiedQuantity: number; pendingUnnotified: number;
}

/** Vista previa para preparar un aviso: por línea, llegadas / informadas / pendientes + mensaje sugerido. */
export async function getOrderArrivalNotificationPreview(orderId: number, actorUserId: string | null, client: Client = prisma) {
  const order = await loadOrderForNotify(client, orderId);
  await authorizeStoreAccess(client, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  const notified = await notifiedByLine(client, orderId);
  const lines: ArrivalPreviewLine[] = order.lines.map((l) => {
    const n = notified.get(l.id) ?? 0;
    return { orderLineId: l.id, title: l.titleSnapshot, volumeNumber: l.volumeNumberSnapshot, arrivedQuantity: l.arrivedQuantity, notifiedQuantity: n, pendingUnnotified: unnotifiedArrivalQuantity(l.arrivedQuantity, n) };
  });
  const pending = lines.filter((l) => l.pendingUnnotified > 0);
  const suggestedMessage = buildArrivalMessage({
    customerName: order.customerNameSnapshot, storeName: order.store.name, publicCode: order.publicCode,
    items: pending.map((l) => ({ title: l.title, volumeNumber: l.volumeNumber, quantity: l.pendingUnnotified })),
  });
  return { orderId, publicCode: order.publicCode, status: order.status, lines, suggestedMessage, hasPending: pending.length > 0 };
}

export interface CreateDraftInput {
  orderId: number;
  items: { orderLineId: number; quantity: number }[];
  message?: string | null;
}

/** Crea un borrador de aviso (§8). Valida selección contra pendientes (soft; definitivo al enviar). */
export async function createArrivalNotificationDraft(input: CreateDraftInput, actorUserId: string | null, client: Client = prisma) {
  const order = await loadOrderForNotify(client, input.orderId);
  const ctx = await authorizeStoreAccess(client, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  if (order.status === ORDER_STATUS.CANCELLED) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");

  const lineById = new Map(order.lines.map((l) => [l.id, l]));
  const notified = await notifiedByLine(client, input.orderId);
  const selection: SelectionItem[] = input.items.map((it) => {
    const line = lineById.get(it.orderLineId);
    if (!line) throw new RetailError(RETAIL_ERROR.ORDER_LINE_NOT_FOUND, "la línea no pertenece a la orden");
    return { orderLineId: it.orderLineId, quantity: it.quantity, pendingUnnotified: unnotifiedArrivalQuantity(line.arrivedQuantity, notified.get(it.orderLineId) ?? 0) };
  });
  const consolidated = assertValidSelection(selection); // valida no-vacío, cantidades y tope pendiente

  const items = [...consolidated.entries()].map(([orderLineId, quantity]) => ({ orderLineId, quantity }));
  const messageInput = {
    customerName: order.customerNameSnapshot, storeName: order.store.name, publicCode: order.publicCode,
    items: items.map((i) => { const l = lineById.get(i.orderLineId)!; return { title: l.titleSnapshot, volumeNumber: l.volumeNumberSnapshot, quantity: i.quantity }; }),
  };
  const messageSnapshot = input.message ? assertNonEmptyMessage(input.message) : buildArrivalMessage(messageInput);

  return client.storeOrderNotification.create({
    data: {
      orderId: input.orderId, type: NOTIFICATION_TYPE.ARRIVAL, status: NOTIFICATION_STATUS.DRAFT, channel: "MANUAL",
      recipientSnapshot: order.customerNameSnapshot ?? order.customerEmailSnapshot ?? null,
      messageSnapshot, createdByUserId: ctx.userId,
      items: { create: items },
    },
    include: { items: true },
  });
}

async function loadNotification(client: Client, notificationId: number) {
  const n = await client.storeOrderNotification.findUnique({
    where: { id: notificationId },
    select: { id: true, orderId: true, status: true, sendOperationKey: true, messageSnapshot: true, order: { select: { storeId: true, status: true } }, items: { select: { orderLineId: true, quantity: true } } },
  });
  if (!n) throw new RetailError(RETAIL_ERROR.NOTIFICATION_NOT_FOUND);
  return n;
}

/** Edita el mensaje de un borrador (solo DRAFT). Sanea (sin HTML) y exige no vacío. */
export async function updateArrivalNotificationDraft(notificationId: number, message: string, actorUserId: string | null, client: Client = prisma) {
  const n = await loadNotification(client, notificationId);
  await authorizeStoreAccess(client, { storeId: n.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  assertNotificationEditable(n.status as NotificationStatus);
  const messageSnapshot = assertNonEmptyMessage(message);
  return client.storeOrderNotification.update({ where: { id: notificationId }, data: { messageSnapshot } });
}

/** Cancela un borrador (solo DRAFT; SENT es terminal). */
export async function cancelArrivalNotification(notificationId: number, actorUserId: string | null, client: Client = prisma, now: Date = new Date()) {
  const n = await loadNotification(client, notificationId);
  await authorizeStoreAccess(client, { storeId: n.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  assertNotificationEditable(n.status as NotificationStatus); // solo DRAFT
  return client.storeOrderNotification.update({ where: { id: notificationId }, data: { status: NOTIFICATION_STATUS.CANCELLED, cancelledAt: now } });
}

/**
 * Marca un aviso como ENVIADO (§13/§14). Transaccional: bloquea la orden y sus líneas, revalida que los
 * ítems no superen las unidades llegadas aún no informadas, y fija SENT + sentAt + sentBy + sendOperationKey.
 * Idempotente ante retry con la misma `sendOperationKey`; conflicto si la clave pertenece a otro aviso.
 */
export async function markArrivalNotificationSent(notificationId: number, actorUserId: string | null, sendOperationKey: string, client: Client = prisma, now: Date = new Date()) {
  try {
    return await client.$transaction(async (tx) => {
      const head = await tx.storeOrderNotification.findUnique({ where: { id: notificationId }, select: { orderId: true } });
      if (!head) throw new RetailError(RETAIL_ERROR.NOTIFICATION_NOT_FOUND);
      // Bloquear la orden y TODAS sus líneas (serializa con fulfillment y con otros envíos de la orden).
      await tx.$queryRaw`SELECT id FROM "StoreOrder" WHERE id = ${head.orderId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "StoreOrderLine" WHERE "orderId" = ${head.orderId} FOR UPDATE`;

      const n = await loadNotification(tx as unknown as Client, notificationId);
      await authorizeStoreAccess(tx, { storeId: n.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

      if (n.status === NOTIFICATION_STATUS.SENT) {
        if (n.sendOperationKey === sendOperationKey) return tx.storeOrderNotification.findUnique({ where: { id: notificationId } }); // idempotente
        throw new RetailError(RETAIL_ERROR.NOTIFICATION_ALREADY_SENT, "el aviso ya fue enviado");
      }
      if (n.status === NOTIFICATION_STATUS.CANCELLED) throw new RetailError(RETAIL_ERROR.NOTIFICATION_NOT_EDITABLE, "el aviso está cancelado");
      if (n.order.status === ORDER_STATUS.CANCELLED) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");

      // Reconciliar la clave por si ya la tomó otro aviso (además del backstop P2002).
      const keyOwner = await tx.storeOrderNotification.findUnique({ where: { sendOperationKey }, select: { id: true } });
      if (reconcileSendKey(keyOwner ? { notificationId: keyOwner.id, sendOperationKey } : null, notificationId))
        return tx.storeOrderNotification.findUnique({ where: { id: notificationId } });

      // Validación DEFINITIVA de disponibilidad: los ítems no superan lo llegado-no-informado por OTROS SENT.
      const lines = await tx.storeOrderLine.findMany({ where: { orderId: n.orderId }, select: { id: true, arrivedQuantity: true } });
      const arrivedById = new Map(lines.map((l) => [l.id, l.arrivedQuantity]));
      const notified = await notifiedByLine(tx, n.orderId); // solo SENT (este aún es DRAFT → no se cuenta)
      for (const it of n.items) {
        const pending = unnotifiedArrivalQuantity(arrivedById.get(it.orderLineId) ?? 0, notified.get(it.orderLineId) ?? 0);
        if (pending <= 0) throw new RetailError(RETAIL_ERROR.ARRIVAL_ALREADY_NOTIFIED, "esas unidades ya fueron informadas");
        if (it.quantity > pending) throw new RetailError(RETAIL_ERROR.ARRIVAL_NOTIFICATION_EXCEEDS_PENDING, "otro aviso ya informó parte de esas unidades");
      }
      assertNonEmptyMessage(n.messageSnapshot);

      return tx.storeOrderNotification.update({
        where: { id: notificationId },
        data: { status: NOTIFICATION_STATUS.SENT, sentAt: now, sentByUserId: actorUserId, sendOperationKey },
      });
    });
  } catch (err) {
    if (isUniqueViolationOn(err, "sendOperationKey")) {
      const owner = await client.storeOrderNotification.findUnique({ where: { sendOperationKey }, select: { id: true } });
      if (reconcileSendKey(owner ? { notificationId: owner.id, sendOperationKey } : null, notificationId))
        return client.storeOrderNotification.findUnique({ where: { id: notificationId } });
      throw new RetailError(RETAIL_ERROR.NOTIFICATION_OPERATION_KEY_CONFLICT, "clave de envío duplicada");
    }
    throw err;
  }
}

const NOTIFICATION_LIST_SELECT = {
  id: true, type: true, status: true, channel: true, messageSnapshot: true, recipientSnapshot: true,
  createdByUserId: true, sentByUserId: true, createdAt: true, sentAt: true, cancelledAt: true,
  items: { select: { orderLineId: true, quantity: true, orderLine: { select: { titleSnapshot: true, volumeNumberSnapshot: true } } } },
} as const;

/** Todos los avisos de una orden (cualquier estado), para la tienda. */
export async function listOrderNotifications(orderId: number, actorUserId: string | null, client: Client = prisma) {
  const order = await client.storeOrder.findUnique({ where: { id: orderId }, select: { id: true, storeId: true } });
  if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  return client.storeOrderNotification.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, select: NOTIFICATION_LIST_SELECT });
}

/** Un aviso puntual, para la tienda. */
export async function getOrderNotification(notificationId: number, actorUserId: string | null, client: Client = prisma) {
  const n = await client.storeOrderNotification.findUnique({ where: { id: notificationId }, select: { ...NOTIFICATION_LIST_SELECT, order: { select: { storeId: true } } } });
  if (!n) throw new RetailError(RETAIL_ERROR.NOTIFICATION_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: n.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  return n;
}

/** Órdenes de una campaña con unidades LLEGADAS aún no informadas (§19). Solo miembros de la tienda. */
export async function listPendingArrivalNotifications(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const campaign = await client.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true, storeId: true, title: true } });
  if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: campaign.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

  const orders = await client.storeOrder.findMany({
    where: { campaignId, status: { not: ORDER_STATUS.CANCELLED }, lines: { some: { arrivedQuantity: { gt: 0 } } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, publicCode: true, customerNameSnapshot: true, customerEmailSnapshot: true,
      lines: { select: { id: true, arrivedQuantity: true, arrivedAt: true } },
    },
  });
  const result = [];
  for (const o of orders) {
    const notified = await notifiedByLine(client, o.id);
    const pending = o.lines.reduce((s, l) => s + unnotifiedArrivalQuantity(l.arrivedQuantity, notified.get(l.id) ?? 0), 0);
    if (pending > 0) {
      const lastArrival = o.lines.map((l) => l.arrivedAt).filter(Boolean).sort().at(-1) ?? null;
      result.push({ orderId: o.id, publicCode: o.publicCode, customerName: o.customerNameSnapshot ?? o.customerEmailSnapshot, pendingUnnotified: pending, lastArrivalAt: lastArrival });
    }
  }
  return { campaign, orders: result };
}
