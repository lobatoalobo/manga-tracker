/**
 * Infra de Retail / Cumplimiento (Slice 4) — operación física por LÍNEA: pedido al proveedor, llegada
 * (parcial o directa) y cancelación de unidades pendientes, con historial inmutable. Session-free
 * (`actorUserId` explícito). Cada operación: resuelve la línea → deriva `storeId` de su orden → autoriza
 * OWNER/STAFF (`requireEnabled:false`, la operación física continúa aunque el comercio esté deshabilitado) →
 * bloquea la línea (`FOR UPDATE`) → valida estado/cantidades DENTRO de la tx → actualiza contadores + estado
 * derivado + fechas → registra el evento. `operationKey` único = idempotencia (doble click / retry).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeStoreAccess } from "@/lib/storeAccess";
import { STORE_ROLE } from "@/lib/domain/store/authorize";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import { CAMPAIGN_STATUS, type CampaignStatus } from "@/lib/domain/retail/campaign";
import {
  LINE_EVENT_TYPE, applyOrdered, applyArrived, applyCancelled, deriveFulfillmentStatus,
  getOrderFulfillmentSummary, pendingQuantity, reconcileOperationKey, type LineCounters, type LineEventType,
} from "@/lib/domain/retail/fulfillment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

type Client = PrismaClient;
const STORE_ROLES = [STORE_ROLE.OWNER, STORE_ROLE.STAFF] as const;

/** Tipo de evento que produce cada operación (para reconciliar reintentos con la misma key). */
const OP_EVENT_TYPE: Record<OpKind, LineEventType> = {
  ORDERED: LINE_EVENT_TYPE.MARKED_ORDERED,
  ARRIVED: LINE_EVENT_TYPE.MARKED_ARRIVED,
  CANCELLED: LINE_EVENT_TYPE.CANCELLED,
};

const EVENT_KEY_SELECT = { orderLineId: true, type: true, quantity: true } as const;

function isUniqueViolationOn(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === "string" && target.includes(field);
}

const LINE_STATE_SELECT = {
  id: true, orderId: true, quantity: true, orderedQuantity: true, arrivedQuantity: true, cancelledQuantity: true,
  fulfillmentStatus: true, orderedAt: true, arrivedAt: true, cancelledAt: true, titleSnapshot: true, volumeNumberSnapshot: true,
} as const;

function getLineState(client: Pick<PrismaClient, "storeOrderLine">, lineId: number) {
  return client.storeOrderLine.findUnique({ where: { id: lineId }, select: LINE_STATE_SELECT });
}

type OpKind = "ORDERED" | "ARRIVED" | "CANCELLED";

interface RunOpInput {
  lineId: number;
  quantity: number;
  actorUserId: string | null;
  operationKey: string;
  reason?: string | null;
}

/** Núcleo transaccional compartido por las tres operaciones de línea. */
async function runLineOp(kind: OpKind, input: RunOpInput, client: Client, now: Date) {
  const { lineId, quantity, actorUserId, operationKey, reason } = input;
  const expectedType = OP_EVENT_TYPE[kind];
  try {
    return await client.$transaction(async (tx) => {
      // Lock de la línea PRIMERO: serializa reintentos con la misma key y operaciones concurrentes.
      await tx.$queryRaw`SELECT id FROM "StoreOrderLine" WHERE id = ${lineId} FOR UPDATE`;
      const line = await tx.storeOrderLine.findUnique({
        where: { id: lineId },
        select: {
          id: true, quantity: true, orderedQuantity: true, arrivedQuantity: true, cancelledQuantity: true,
          orderedAt: true, arrivedAt: true, cancelledAt: true,
          order: { select: { storeId: true, status: true, campaign: { select: { status: true } } } },
        },
      });
      if (!line) throw new RetailError(RETAIL_ERROR.ORDER_LINE_NOT_FOUND);

      // Autorización por storeId DERIVADO de la orden (no se confía en slug/storeId del cliente).
      await authorizeStoreAccess(tx, { storeId: line.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

      // Idempotencia: si ya existe un evento con esta key, sólo es idempotente si representa EXACTAMENTE la
      // misma operación (línea + tipo + cantidad); si el payload difiere → OPERATION_KEY_CONFLICT.
      const dup = await tx.storeOrderLineEvent.findUnique({ where: { operationKey }, select: EVENT_KEY_SELECT });
      if (reconcileOperationKey(dup, { orderLineId: lineId, type: expectedType, quantity })) return getLineState(tx, lineId);

      const counters: LineCounters = {
        quantity: line.quantity, orderedQuantity: line.orderedQuantity, arrivedQuantity: line.arrivedQuantity, cancelledQuantity: line.cancelledQuantity,
      };
      const orderCancelled = line.order.status === ORDER_STATUS.CANCELLED;
      const campaignCancelled = (line.order.campaign.status as CampaignStatus) === CAMPAIGN_STATUS.CANCELLED;

      let next: LineCounters;
      if (kind === "ORDERED") {
        if (orderCancelled) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");
        if (campaignCancelled) throw new RetailError(RETAIL_ERROR.ORDER_LINE_OPERATION_NOT_ALLOWED, "la campaña está cancelada");
        next = applyOrdered(counters, quantity);
      } else if (kind === "ARRIVED") {
        if (orderCancelled) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");
        if (campaignCancelled) throw new RetailError(RETAIL_ERROR.ORDER_LINE_OPERATION_NOT_ALLOWED, "la campaña está cancelada");
        next = applyArrived(counters, quantity);
      } else {
        // Cancelar unidades pendientes: permitido para resolver actividad aun con campaña cancelada.
        next = applyCancelled(counters, quantity);
      }

      const data: Prisma.StoreOrderLineUpdateInput = {
        orderedQuantity: next.orderedQuantity,
        arrivedQuantity: next.arrivedQuantity,
        cancelledQuantity: next.cancelledQuantity,
        fulfillmentStatus: deriveFulfillmentStatus(next),
      };
      // Fechas: se fijan en la 1ra transición real y no se sobrescriben.
      if (next.orderedQuantity > 0 && !line.orderedAt) data.orderedAt = now;
      if (next.arrivedQuantity > 0 && !line.arrivedAt) data.arrivedAt = now;
      if (kind === "CANCELLED") {
        if (!line.cancelledAt) data.cancelledAt = now;
        data.cancelledBy = actorUserId ? { connect: { id: actorUserId } } : undefined;
        const trimmed = reason?.trim();
        if (trimmed) data.cancellationReason = trimmed.slice(0, 280);
      }

      await tx.storeOrderLine.update({ where: { id: lineId }, data });
      await tx.storeOrderLineEvent.create({
        data: { orderLineId: lineId, type: expectedType, quantity, actorUserId, operationKey, note: reason?.trim()?.slice(0, 280) || null },
      });
      return getLineState(tx, lineId);
    });
  } catch (err) {
    if (isUniqueViolationOn(err, "operationKey")) {
      // Carrera perdida contra la misma key: idempotente sólo si el evento es la MISMA operación; si no, conflicto.
      const ev = await client.storeOrderLineEvent.findUnique({ where: { operationKey }, select: EVENT_KEY_SELECT });
      if (reconcileOperationKey(ev, { orderLineId: lineId, type: expectedType, quantity })) return getLineState(client, lineId);
      throw new RetailError(RETAIL_ERROR.OPERATION_KEY_CONFLICT, "operationKey duplicada");
    }
    throw err;
  }
}

/** Marca `quantity` unidades como pedidas al proveedor. */
export function markOrderLineOrdered(lineId: number, quantity: number, actorUserId: string | null, operationKey: string, client: Client = prisma, now: Date = new Date()) {
  return runLineOp("ORDERED", { lineId, quantity, actorUserId, operationKey }, client, now);
}
/** Registra `quantity` unidades llegadas (parcial o directa). */
export function markOrderLineArrived(lineId: number, quantity: number, actorUserId: string | null, operationKey: string, client: Client = prisma, now: Date = new Date()) {
  return runLineOp("ARRIVED", { lineId, quantity, actorUserId, operationKey }, client, now);
}
/** Cancela `quantity` unidades PENDIENTES de una línea (nunca las ya llegadas). */
export function cancelOrderLineQuantity(lineId: number, quantity: number, reason: string | null, actorUserId: string | null, operationKey: string, client: Client = prisma, now: Date = new Date()) {
  return runLineOp("CANCELLED", { lineId, quantity, actorUserId, operationKey, reason }, client, now);
}

/** Historial operativo (inmutable, ascendente) de una línea. Solo miembros de la tienda. */
export async function getOrderLineHistory(lineId: number, actorUserId: string | null, client: Client = prisma) {
  const line = await client.storeOrderLine.findUnique({ where: { id: lineId }, select: { id: true, order: { select: { storeId: true } } } });
  if (!line) throw new RetailError(RETAIL_ERROR.ORDER_LINE_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: line.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  return client.storeOrderLineEvent.findMany({
    where: { orderLineId: lineId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, quantity: true, actorUserId: true, note: true, createdAt: true },
  });
}

/** Vista agregada de cumplimiento de una campaña, por oferta (§16). Solo miembros de la tienda. */
export async function getCampaignFulfillment(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const campaign = await client.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true, storeId: true, title: true, status: true } });
  if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: campaign.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

  // Solo líneas de órdenes NO canceladas cuentan como demanda real de la campaña.
  const lines = await client.storeOrderLine.findMany({
    where: { order: { campaignId, status: { not: ORDER_STATUS.CANCELLED } } },
    select: { offerId: true, quantity: true, orderedQuantity: true, arrivedQuantity: true, cancelledQuantity: true, titleSnapshot: true, volumeNumberSnapshot: true },
  });

  const byOffer = new Map<number, { offerId: number; title: string; volumeNumber: number | null; reserved: number; ordered: number; arrived: number; cancelled: number; pending: number; orderCount: number }>();
  for (const l of lines) {
    const row = byOffer.get(l.offerId) ?? { offerId: l.offerId, title: l.titleSnapshot, volumeNumber: l.volumeNumberSnapshot, reserved: 0, ordered: 0, arrived: 0, cancelled: 0, pending: 0, orderCount: 0 };
    row.reserved += l.quantity;
    row.ordered += l.orderedQuantity;
    row.arrived += l.arrivedQuantity;
    row.cancelled += l.cancelledQuantity;
    row.pending += pendingQuantity(l);
    row.orderCount += 1;
    byOffer.set(l.offerId, row);
  }
  return { campaign, offers: [...byOffer.values()].sort((a, b) => (a.volumeNumber ?? 0) - (b.volumeNumber ?? 0)) };
}

export { getOrderFulfillmentSummary };
