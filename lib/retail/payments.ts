/**
 * Infra de Retail / Pagos manuales (Slice 6). Session-free (`actorUserId` explícito). Toda operación deriva la
 * tienda/orden desde la propia orden (nunca confía en storeId/slug/campaignId del cliente) y autoriza
 * OWNER/STAFF con `requireEnabled:false` (el historial financiero se consulta y opera aunque el comercio esté
 * deshabilitado). El pago es MANUAL: la tienda registra un pago que ya verificó; Nakama no cobra ni procesa.
 *
 * `paidCents`/`paymentStatus` de la orden son una PROYECCIÓN derivada del ledger de StorePayment (Σ CONFIRMED)
 * contra `totalCents` congelado; se recomputan dentro de la MISMA transacción que registra el pago, bajo lock.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeStoreAccess } from "@/lib/storeAccess";
import { STORE_ROLE } from "@/lib/domain/store/authorize";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import {
  PAYMENT_MOVEMENT_STATUS,
  assertValidAmount, assertValidMethod, assertRegisterable, sanitizePaymentNote,
  computePaidCents, computeRemainingCents, derivePaymentStatus, reconcilePaymentKey,
  type PaymentPayload,
} from "@/lib/domain/retail/payment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

type Client = PrismaClient;
const STORE_ROLES = [STORE_ROLE.OWNER, STORE_ROLE.STAFF] as const;

function isUniqueViolationOn(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === "string" && target.includes(field);
}

/** Campos mínimos para reconciliar un pago existente por su `recordOperationKey` (nota ya persistida saneada). */
const PAYMENT_KEY_SELECT = { id: true, orderId: true, amountCents: true, method: true, paidAt: true, note: true } as const;

/** Vista para reconciliar → estructura pura `ExistingPaymentView`. */
function toExistingView(p: { id: number; orderId: number; amountCents: number; method: string; paidAt: Date; note: string | null }) {
  return { id: p.id, orderId: p.orderId, amountCents: p.amountCents, method: p.method, paidAtMs: p.paidAt.getTime(), note: p.note };
}

/** Suma de pagos CONFIRMED de una orden (la verdad del ledger). */
async function paidCentsOf(client: Pick<PrismaClient, "storePayment">, orderId: number): Promise<number> {
  const rows = await client.storePayment.findMany({
    where: { orderId, status: PAYMENT_MOVEMENT_STATUS.CONFIRMED },
    select: { amountCents: true },
  });
  return computePaidCents(rows.map((r) => r.amountCents));
}

const PAYMENT_ROW_SELECT = {
  id: true, status: true, amountCents: true, method: true, note: true, paidAt: true,
  confirmedByUserId: true, createdAt: true,
} as const;

export interface RegisterPaymentInput {
  orderId: number;
  amountCents: number;
  method: string;
  /** Instante en que el cliente pagó (según la tienda). Estable por intento (lo aporta la acción/UI). */
  paidAt: Date;
  note?: string | null;
}

/**
 * Registra un pago CONFIRMED (§7). Transaccional: bloquea la orden (`FOR UPDATE`), revalida acceso y estado
 * (rechaza `CANCELLED`), reconcilia `recordOperationKey`, inserta el pago y RECOMPUTA `paidCents`/`paymentStatus`
 * desde todos los pagos CONFIRMED de la orden. Idempotente ante retry con la misma clave + mismo payload;
 * conflicto si la clave pertenece a un pago con payload distinto. `P2002` traducido (sin exponer Prisma).
 */
export async function registerPayment(input: RegisterPaymentInput, actorUserId: string | null, recordOperationKey: string, client: Client = prisma, now: Date = new Date()) {
  // Validaciones puras (fuera de la tx): monto y método. La nota se sanea para persistir y reconciliar.
  assertValidAmount(input.amountCents);
  assertValidMethod(input.method);
  const note = sanitizePaymentNote(input.note);
  const payload: PaymentPayload = { orderId: input.orderId, amountCents: input.amountCents, method: input.method, paidAtMs: input.paidAt.getTime(), note };

  try {
    return await client.$transaction(async (tx) => {
      // Lock de la orden PRIMERO: serializa registros concurrentes y el recómputo de la proyección.
      await tx.$queryRaw`SELECT id FROM "StoreOrder" WHERE id = ${input.orderId} FOR UPDATE`;
      const order = await tx.storeOrder.findUnique({ where: { id: input.orderId }, select: { id: true, storeId: true, status: true, totalCents: true } });
      if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);

      // Autorización por storeId DERIVADO de la orden (no se confía en slug/ids del cliente).
      await authorizeStoreAccess(tx, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

      // Idempotencia: si la clave ya existe, es idempotente solo con EL MISMO payload; si difiere → conflicto.
      const dup = await tx.storePayment.findUnique({ where: { recordOperationKey }, select: PAYMENT_KEY_SELECT });
      if (reconcilePaymentKey(dup ? toExistingView(dup) : null, payload)) return tx.storePayment.findUnique({ where: { recordOperationKey }, select: PAYMENT_ROW_SELECT });

      // No se paga una orden cancelada.
      assertRegisterable(order.status);

      await tx.storePayment.create({
        data: {
          orderId: input.orderId, status: PAYMENT_MOVEMENT_STATUS.CONFIRMED, amountCents: input.amountCents,
          method: input.method, note, paidAt: input.paidAt, confirmedByUserId: actorUserId, recordOperationKey,
        },
      });

      // Recomputar la proyección desde TODOS los pagos CONFIRMED (incluye el recién insertado) bajo el lock.
      const paidCents = await paidCentsOf(tx, input.orderId);
      await tx.storeOrder.update({
        where: { id: input.orderId },
        data: { paidCents, paymentStatus: derivePaymentStatus(order.totalCents, paidCents) },
      });

      return tx.storePayment.findUnique({ where: { recordOperationKey }, select: PAYMENT_ROW_SELECT });
    });
  } catch (err) {
    if (isUniqueViolationOn(err, "recordOperationKey")) {
      // Carrera perdida contra la misma clave: idempotente solo si el pago es el MISMO payload; si no, conflicto.
      const ev = await client.storePayment.findUnique({ where: { recordOperationKey }, select: PAYMENT_KEY_SELECT });
      if (reconcilePaymentKey(ev ? toExistingView(ev) : null, payload)) return client.storePayment.findUnique({ where: { recordOperationKey }, select: PAYMENT_ROW_SELECT });
      throw new RetailError(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT, "recordOperationKey duplicada");
    }
    throw err;
  }
}

/** Carga la orden con storeId (para autorizar) o lanza ORDER_NOT_FOUND. */
async function loadOrderForPayments(client: Client, orderId: number) {
  const order = await client.storeOrder.findUnique({ where: { id: orderId }, select: { id: true, storeId: true, status: true, totalCents: true, paidCents: true, paymentStatus: true } });
  if (!order) throw new RetailError(RETAIL_ERROR.ORDER_NOT_FOUND);
  return order;
}

/** Pagos CONFIRMED de una orden (para la tienda), del más reciente al más antiguo. */
export async function listOrderPayments(orderId: number, actorUserId: string | null, client: Client = prisma) {
  const order = await loadOrderForPayments(client, orderId);
  await authorizeStoreAccess(client, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  return client.storePayment.findMany({
    where: { orderId, status: PAYMENT_MOVEMENT_STATUS.CONFIRMED },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    select: PAYMENT_ROW_SELECT,
  });
}

/** Resumen de pago de una orden (para la tienda): totales derivados + pagos CONFIRMED. */
export async function getOrderPaymentSummary(orderId: number, actorUserId: string | null, client: Client = prisma) {
  const order = await loadOrderForPayments(client, orderId);
  await authorizeStoreAccess(client, { storeId: order.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });
  const payments = await client.storePayment.findMany({
    where: { orderId, status: PAYMENT_MOVEMENT_STATUS.CONFIRMED },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    select: PAYMENT_ROW_SELECT,
  });
  return {
    orderId: order.id,
    totalCents: order.totalCents,
    paidCents: order.paidCents,
    remainingCents: computeRemainingCents(order.totalCents, order.paidCents),
    paymentStatus: order.paymentStatus,
    payments,
  };
}

/**
 * Vista agregada de pagos de una campaña (§12). Solo miembros de la tienda. Las métricas comerciales EXCLUYEN
 * órdenes CANCELLED (misma convención que la vista de cumplimiento §16). Devuelve totales + conteo por estado.
 */
export async function getCampaignPaymentSummary(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const campaign = await client.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true, storeId: true, title: true } });
  if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: campaign.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

  const orders = await client.storeOrder.findMany({
    where: { campaignId, status: { not: ORDER_STATUS.CANCELLED } },
    select: { id: true, totalCents: true, paidCents: true, paymentStatus: true },
  });
  const byStatus: Record<string, number> = { UNPAID: 0, PARTIALLY_PAID: 0, PAID: 0, OVERPAID: 0 };
  let billedCents = 0;
  let paidCents = 0;
  for (const o of orders) {
    billedCents += o.totalCents;
    paidCents += o.paidCents;
    byStatus[o.paymentStatus] = (byStatus[o.paymentStatus] ?? 0) + 1;
  }
  return {
    campaign,
    orderCount: orders.length,
    billedCents,
    paidCents,
    collectedPercent: billedCents > 0 ? Math.round((paidCents / billedCents) * 100) : 0,
    byStatus,
  };
}

/** Órdenes de una campaña con saldo pendiente (`remainingCents > 0`), para el tablero de pagos (§12). */
export async function listPendingPayments(campaignId: number, actorUserId: string | null, client: Client = prisma) {
  const campaign = await client.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true, storeId: true, title: true } });
  if (!campaign) throw new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_FOUND);
  await authorizeStoreAccess(client, { storeId: campaign.storeId }, actorUserId, { allowedRoles: STORE_ROLES, requireEnabled: false });

  const orders = await client.storeOrder.findMany({
    where: { campaignId, status: { not: ORDER_STATUS.CANCELLED } },
    orderBy: { createdAt: "asc" },
    select: { id: true, publicCode: true, customerNameSnapshot: true, customerEmailSnapshot: true, totalCents: true, paidCents: true, paymentStatus: true },
  });
  return {
    campaign,
    orders: orders
      .map((o) => ({
        orderId: o.id, publicCode: o.publicCode, customerName: o.customerNameSnapshot ?? o.customerEmailSnapshot,
        totalCents: o.totalCents, paidCents: o.paidCents, paymentStatus: o.paymentStatus,
        remainingCents: computeRemainingCents(o.totalCents, o.paidCents),
      }))
      .filter((o) => o.remainingCents > 0),
  };
}
