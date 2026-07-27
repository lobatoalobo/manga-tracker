/**
 * Infra de Retail / Preparación y retiro (Slice 7). Session-free (`actorUserId` explícito). Continúa el ciclo
 * físico outbound de Slice 4 reusando su MISMO ledger inmutable (`StoreOrderLineEvent`), la idempotencia por
 * `operationKey` (`reconcileOperationKey`), los locks `FOR UPDATE` y la traducción de `P2002`. Cada operación
 * deriva la tienda desde la orden/línea (nunca confía en slug/ids del cliente) y autoriza OWNER/STAFF con
 * `requireEnabled:false` (la operación física continúa aunque el comercio esté deshabilitado).
 *
 * El eje es ORTOGONAL al pago: este servicio NO lee ni escribe `paymentStatus`/`paidCents`. El único punto de
 * un futuro gate de pago está marcado como SEAM en la rama PICKUP (no cableado). No escribe colección.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeStoreAccess } from "@/lib/storeAccess";
import { STORE_ROLE } from "@/lib/domain/store/authorize";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import { LINE_EVENT_TYPE, reconcileOperationKey, type LineEventType } from "@/lib/domain/retail/fulfillment";
import { applyPrepared, applyPickedUp, pickupableQuantity, type HandoffCounters } from "@/lib/domain/retail/handoff";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

type Client = PrismaClient;
const STORE_ROLES = [STORE_ROLE.OWNER, STORE_ROLE.STAFF] as const;

type HandoffKind = "PREPARE" | "PICKUP";
const KIND_EVENT_TYPE: Record<HandoffKind, LineEventType> = {
  PREPARE: LINE_EVENT_TYPE.PREPARED,
  PICKUP: LINE_EVENT_TYPE.PICKED_UP,
};

const EVENT_KEY_SELECT = { orderLineId: true, type: true, quantity: true } as const;
/** Estado de línea devuelto por las operaciones (contadores del ciclo físico). */
const LINE_STATE_SELECT = {
  id: true, orderId: true, quantity: true, arrivedQuantity: true, cancelledQuantity: true,
  preparedQuantity: true, pickedUpQuantity: true, titleSnapshot: true, volumeNumberSnapshot: true,
} as const;

function isUniqueViolationOn(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === "string" && target.includes(field);
}

function getLineState(client: Pick<PrismaClient, "storeOrderLine">, lineId: number) {
  return client.storeOrderLine.findUnique({ where: { id: lineId }, select: LINE_STATE_SELECT });
}

/** Aplica la transición pura correspondiente y devuelve el campo de contador a actualizar. */
function applyHandoff(kind: HandoffKind, counters: HandoffCounters, qty: number): Prisma.StoreOrderLineUpdateInput {
  if (kind === "PREPARE") return { preparedQuantity: applyPrepared(counters, qty).preparedQuantity };
  return { pickedUpQuantity: applyPickedUp(counters, qty).pickedUpQuantity };
}

// --- Operaciones INDIVIDUALES (lock de línea) -------------------------------------------------------------

interface RunHandoffInput { lineId: number; quantity: number; actorUserId: string | null; operationKey: string }

async function runHandoffOp(kind: HandoffKind, input: RunHandoffInput, client: Client) {
  const { lineId, quantity, actorUserId, operationKey } = input;
  const expectedType = KIND_EVENT_TYPE[kind];
  try {
    return await client.$transaction(async (tx) => {
      // Lock de la línea PRIMERO: serializa reintentos con la misma key y operaciones concurrentes.
      await tx.$queryRaw`SELECT id FROM "StoreOrderLine" WHERE id = ${lineId} FOR UPDATE`;
      const line = await tx.storeOrderLine.findUnique({
        where: { id: lineId },
        select: {
          id: true, quantity: true, arrivedQuantity: true, cancelledQuantity: true, preparedQuantity: true, pickedUpQuantity: true,
          order: { select: { storeId: true, status: true, userId: true } }, // userId = DUEÑO de la orden (snapshot Slice 8)
        },
      });
      if (!line) throw new RetailError(RETAIL_ERROR.ORDER_LINE_NOT_FOUND);

      await authorizeStoreAccess(tx, { storeId: line.order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
      if (line.order.status === ORDER_STATUS.CANCELLED) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");

      // Idempotencia: si la key ya existe, solo es idempotente para la MISMA operación (línea+tipo+cantidad).
      const dup = await tx.storeOrderLineEvent.findUnique({ where: { operationKey }, select: EVENT_KEY_SELECT });
      if (reconcileOperationKey(dup, { orderLineId: lineId, type: expectedType, quantity })) return getLineState(tx, lineId);

      // SEAM (futuro gate de pago del retiro): acá iría `assertPickupAllowed(order.paymentStatus, policy)` para
      // PICKUP. Slice 7 NO lo cablea: el retiro no depende del pago (solo se muestra informativo en la UI).

      const counters: HandoffCounters = {
        quantity: line.quantity, arrivedQuantity: line.arrivedQuantity, cancelledQuantity: line.cancelledQuantity,
        preparedQuantity: line.preparedQuantity, pickedUpQuantity: line.pickedUpQuantity,
      };
      await tx.storeOrderLine.update({ where: { id: lineId }, data: applyHandoff(kind, counters, quantity) });
      await tx.storeOrderLineEvent.create({
        // Snapshot Slice 8: SOLO en PICKED_UP, tomado del DUEÑO de la orden (`line.order.userId`) dentro de esta
        // misma tx — NUNCA de `actorUserId` (que es el staff). PICKED_UP no puebla `note`.
        data: { orderLineId: lineId, type: expectedType, quantity, actorUserId, operationKey, ownerUserIdSnapshot: kind === "PICKUP" ? line.order.userId : null },
      });
      return getLineState(tx, lineId);
    });
  } catch (err) {
    if (isUniqueViolationOn(err, "operationKey")) {
      const ev = await client.storeOrderLineEvent.findUnique({ where: { operationKey }, select: EVENT_KEY_SELECT });
      if (reconcileOperationKey(ev, { orderLineId: lineId, type: expectedType, quantity })) return getLineState(client, lineId);
      throw new RetailError(RETAIL_ERROR.OPERATION_KEY_CONFLICT, "operationKey duplicada");
    }
    throw err;
  }
}

/** Prepara `quantity` unidades LLEGADAS de una línea. */
export function prepareOrderLine(lineId: number, quantity: number, actorUserId: string | null, operationKey: string, client: Client = prisma) {
  return runHandoffOp("PREPARE", { lineId, quantity, actorUserId, operationKey }, client);
}
/** Registra el retiro de `quantity` unidades PREPARADAS de una línea. */
export function pickupOrderLine(lineId: number, quantity: number, actorUserId: string | null, operationKey: string, client: Client = prisma) {
  return runHandoffOp("PICKUP", { lineId, quantity, actorUserId, operationKey }, client);
}

// --- Operaciones MASIVAS (payload explícito inmutable; lock orden→líneas) ----------------------------------

export interface HandoffBatchItem { orderLineId: number; quantity: number }

/**
 * Clave de idempotencia determinística de un ítem de un lote de handoff: `${batchOperationKey}:${segment}:${id}`.
 * Fuente ÚNICA del formato — la usan tanto el servicio (para crear el evento) como la capa de aplicación (para
 * reconstruir las claves exactas del pickup y proyectar la colección). No acopla Retail a Collection.
 */
export function handoffBatchItemKey(batchOperationKey: string, segment: "prepare" | "pickup", orderLineId: number): string {
  return `${batchOperationKey}:${segment}:${orderLineId}`;
}

/**
 * Valida el payload de un lote (PURO, previo a la tx): no vacío, sin líneas duplicadas, cantidades enteras ≥ 1.
 * El alcance del comando es EXACTAMENTE `items` — nunca se recalcula desde la disponibilidad actual.
 */
function assertValidBatch(items: readonly HandoffBatchItem[]): void {
  if (!items || items.length === 0) throw new RetailError(RETAIL_ERROR.EMPTY_HANDOFF_BATCH, "el lote no tiene ítems");
  const seen = new Set<number>();
  for (const it of items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1) throw new RetailError(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY, "la cantidad debe ser un entero ≥ 1");
    if (seen.has(it.orderLineId)) throw new RetailError(RETAIL_ERROR.DUPLICATE_HANDOFF_ITEM, "hay líneas duplicadas en el lote");
    seen.add(it.orderLineId);
  }
}

async function runHandoffBatch(kind: HandoffKind, orderId: number, items: readonly HandoffBatchItem[], actorUserId: string | null, batchOperationKey: string, client: Client) {
  assertValidBatch(items);
  const expectedType = KIND_EVENT_TYPE[kind];
  const keyOf = (orderLineId: number) => handoffBatchItemKey(batchOperationKey, kind === "PREPARE" ? "prepare" : "pickup", orderLineId);
  // Alcance INMUTABLE: se procesan los items del payload en orden ascendente de línea (determinístico).
  const ordered = [...items].sort((a, b) => a.orderLineId - b.orderLineId);
  try {
    return await client.$transaction(async (tx) => {
      // Lock orden PRIMERO, luego TODAS sus líneas asc (orden de locks estable → sin deadlocks).
      await tx.$queryRaw`SELECT id FROM "StoreOrder" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.storeOrder.findUnique({ where: { id: orderId }, select: { id: true, storeId: true, status: true, userId: true } }); // userId = DUEÑO (snapshot Slice 8)
      if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
      await tx.$queryRaw`SELECT id FROM "StoreOrderLine" WHERE "orderId" = ${orderId} ORDER BY id FOR UPDATE`;

      await authorizeStoreAccess(tx, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
      if (order.status === ORDER_STATUS.CANCELLED) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");

      const lines = await tx.storeOrderLine.findMany({ where: { orderId }, select: { id: true, quantity: true, arrivedQuantity: true, cancelledQuantity: true, preparedQuantity: true, pickedUpQuantity: true } });
      const byId = new Map(lines.map((l) => [l.id, l]));

      for (const it of ordered) {
        const line = byId.get(it.orderLineId);
        if (!line) throw new RetailError(RETAIL_ERROR.ORDER_LINE_NOT_FOUND, "la línea no pertenece a la orden");
        const operationKey = keyOf(it.orderLineId);
        // Reconcilia contra la cantidad INMUTABLE del payload (no se recalcula el alcance en un retry).
        const dup = await tx.storeOrderLineEvent.findUnique({ where: { operationKey }, select: EVENT_KEY_SELECT });
        if (reconcileOperationKey(dup, { orderLineId: it.orderLineId, type: expectedType, quantity: it.quantity })) continue; // ya aplicado → idempotente

        const counters: HandoffCounters = {
          quantity: line.quantity, arrivedQuantity: line.arrivedQuantity, cancelledQuantity: line.cancelledQuantity,
          preparedQuantity: line.preparedQuantity, pickedUpQuantity: line.pickedUpQuantity,
        };
        await tx.storeOrderLine.update({ where: { id: it.orderLineId }, data: applyHandoff(kind, counters, it.quantity) });
        // Snapshot Slice 8: SOLO en PICKED_UP, desde el DUEÑO (`order.userId`) en esta misma tx — nunca `actorUserId`.
        await tx.storeOrderLineEvent.create({ data: { orderLineId: it.orderLineId, type: expectedType, quantity: it.quantity, actorUserId, operationKey, ownerUserIdSnapshot: kind === "PICKUP" ? order.userId : null } });
      }
      return tx.storeOrderLine.findMany({ where: { orderId }, orderBy: { id: "asc" }, select: LINE_STATE_SELECT });
    });
  } catch (err) {
    if (isUniqueViolationOn(err, "operationKey")) throw new RetailError(RETAIL_ERROR.OPERATION_KEY_CONFLICT, "operationKey de lote duplicada");
    throw err;
  }
}

/** Prepara los deltas explícitos de varias líneas de una orden, atómicamente. */
export function prepareOrderLines(orderId: number, items: HandoffBatchItem[], actorUserId: string | null, batchOperationKey: string, client: Client = prisma) {
  return runHandoffBatch("PREPARE", orderId, items, actorUserId, batchOperationKey, client);
}
/** Registra el retiro de los deltas explícitos de varias líneas de una orden, atómicamente. */
export function pickupOrderLines(orderId: number, items: HandoffBatchItem[], actorUserId: string | null, batchOperationKey: string, client: Client = prisma) {
  return runHandoffBatch("PICKUP", orderId, items, actorUserId, batchOperationKey, client);
}

// --- Vista agregada de campaña (§7) -----------------------------------------------------------------------

/** Preparación/retiro agregado por oferta (solo órdenes NO canceladas). Solo miembros de la tienda. */
export async function getCampaignHandoff(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const campaign = await client.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true, storeId: true, title: true } });
  if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: campaign.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

  const lines = await client.storeOrderLine.findMany({
    where: { order: { campaignId, status: { not: ORDER_STATUS.CANCELLED } } },
    select: { offerId: true, quantity: true, arrivedQuantity: true, cancelledQuantity: true, preparedQuantity: true, pickedUpQuantity: true, titleSnapshot: true, volumeNumberSnapshot: true },
  });

  const byOffer = new Map<number, { offerId: number; title: string; volumeNumber: number | null; reserved: number; arrived: number; prepared: number; pickedUp: number; readyForPickup: number }>();
  for (const l of lines) {
    const row = byOffer.get(l.offerId) ?? { offerId: l.offerId, title: l.titleSnapshot, volumeNumber: l.volumeNumberSnapshot, reserved: 0, arrived: 0, prepared: 0, pickedUp: 0, readyForPickup: 0 };
    row.reserved += l.quantity;
    row.arrived += l.arrivedQuantity;
    row.prepared += l.preparedQuantity;
    row.pickedUp += l.pickedUpQuantity;
    row.readyForPickup += pickupableQuantity(l);
    byOffer.set(l.offerId, row);
  }
  return { campaign, offers: [...byOffer.values()].sort((a, b) => (a.volumeNumber ?? 0) - (b.volumeNumber ?? 0)) };
}
