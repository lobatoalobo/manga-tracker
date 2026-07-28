/**
 * Integración de Retail — Pagos manuales (Slice 6) contra Postgres REAL desechable (harness efímero; skip sin
 * `IDENTITY_TEST_DATABASE_URL`). Ejercita registro (único/parcial/múltiple/sobrepago), proyección derivada,
 * concurrencia, idempotencia/conflicto, permisos, privacidad del cliente, bloqueo de cancelación, FKs, SetNull
 * y vista agregada. Solo se crean movimientos CONFIRMED (no hay edición/borrado/VOID en esta slice).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember, setCommerceEnabled } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder, cancelStoreOrder, cancelCustomerOrder, getCustomerOrder } from "@/lib/retail/orders";
import {
  registerPayment, listOrderPayments, getOrderPaymentSummary, getCampaignPaymentSummary, listPendingPayments,
} from "@/lib/retail/payments";
import { STORE_ROLE, StoreAuthError } from "@/lib/domain/store/authorize";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Pagos manuales (Slice 6, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `pm-${Date.now()}-${seq++}`;
  const key = () => `pk-${Date.now()}-${seq++}`;
  const when = new Date("2026-07-20T12:00:00.000Z");

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@pm.dev`, name: `P-${seq}` }, select: { id: true } })).id;
  const store = async () => (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
  async function commerceStore(enabled = true) {
    const owner = await user();
    const storeId = await store();
    const p = await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled }, prisma);
    return { storeId, owner, profileId: p.id, slug: p.slug };
  }
  async function volume(number = 1) {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea Argentina", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number }, select: { id: true } })).id;
  }
  /** Orden RESERVED de una línea con `qty` unidades a `price` centavos c/u (total = qty*price). */
  async function reservedOrder(storeId: number, owner: string, qty = 2, price = 50000) {
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const volumeId = await volume(1);
    const o = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: price * 2, preorderPriceCents: price }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const client = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: o.id, quantity: qty }] }, client, prisma);
    return { campaignId: c.id, order, client };
  }
  const retailCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; } };
  const authThrows = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch (e) { return e instanceof StoreAuthError; } };

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.storePayment.deleteMany({});
    await prisma.storeOrderNotificationItem.deleteMany({});
    await prisma.storeOrderNotification.deleteMany({});
    await prisma.storeOrderLineEvent.deleteMany({});
    await prisma.storeOrderLine.deleteMany({});
    await prisma.storeOrder.deleteMany({});
    await prisma.preorderOffer.deleteMany({});
    await prisma.preorderCampaign.deleteMany({});
    await prisma.storeMember.deleteMany({});
    await prisma.storeCommerceProfile.deleteMany({});
    await prisma.volume.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.deleteMany({});
    await prisma.store.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@pm.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("pago único → PAID; proyección paidCents/paymentStatus", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000); // total 100000
    const p = await registerPayment({ orderId: order.id, amountCents: 100000, method: "TRANSFER", paidAt: when }, owner, key(), prisma);
    expect(p?.status).toBe("CONFIRMED");
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id }, select: { paidCents: true, paymentStatus: true } });
    expect(row).toMatchObject({ paidCents: 100000, paymentStatus: "PAID" });
  });

  it("pago parcial → PARTIALLY_PAID; múltiples pagos suman → PAID", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000); // total 100000
    await registerPayment({ orderId: order.id, amountCents: 40000, method: "CASH", paidAt: when }, owner, key(), prisma);
    let s = await getOrderPaymentSummary(order.id, owner, prisma);
    expect(s).toMatchObject({ paidCents: 40000, remainingCents: 60000, paymentStatus: "PARTIALLY_PAID" });
    await registerPayment({ orderId: order.id, amountCents: 60000, method: "TRANSFER", paidAt: when }, owner, key(), prisma);
    s = await getOrderPaymentSummary(order.id, owner, prisma);
    expect(s).toMatchObject({ paidCents: 100000, remainingCents: 0, paymentStatus: "PAID" });
    expect(s.payments).toHaveLength(2);
  });

  it("sobrepago → OVERPAID, sin bloqueo", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 1, 50000); // total 50000
    await registerPayment({ orderId: order.id, amountCents: 60000, method: "TRANSFER", paidAt: when }, owner, key(), prisma);
    const s = await getOrderPaymentSummary(order.id, owner, prisma);
    expect(s).toMatchObject({ paidCents: 60000, remainingCents: 0, paymentStatus: "OVERPAID" });
  });

  it("dos pagos concurrentes legítimos (claves distintas) → proyección correcta", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000); // total 100000
    await Promise.all([
      registerPayment({ orderId: order.id, amountCents: 30000, method: "CASH", paidAt: when }, owner, key(), prisma),
      registerPayment({ orderId: order.id, amountCents: 70000, method: "TRANSFER", paidAt: when }, owner, key(), prisma),
    ]);
    const s = await getOrderPaymentSummary(order.id, owner, prisma);
    expect(s).toMatchObject({ paidCents: 100000, paymentStatus: "PAID" });
    expect(s.payments).toHaveLength(2);
  });

  it("doble submit / retry con la misma clave → idempotente (no duplica)", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    const k = key();
    const a = await registerPayment({ orderId: order.id, amountCents: 40000, method: "TRANSFER", paidAt: when }, owner, k, prisma);
    const b = await registerPayment({ orderId: order.id, amountCents: 40000, method: "TRANSFER", paidAt: when }, owner, k, prisma);
    expect(b?.id).toBe(a?.id);
    const count = await prisma.storePayment.count({ where: { orderId: order.id } });
    expect(count).toBe(1);
    const s = await getOrderPaymentSummary(order.id, owner, prisma);
    expect(s.paidCents).toBe(40000);
  });

  it("misma clave con payload distinto → PAYMENT_OPERATION_KEY_CONFLICT (P2002 traducido)", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    const k = key();
    await registerPayment({ orderId: order.id, amountCents: 40000, method: "TRANSFER", paidAt: when }, owner, k, prisma);
    expect(await retailCode(() => registerPayment({ orderId: order.id, amountCents: 55000, method: "TRANSFER", paidAt: when }, owner, k, prisma))).toBe(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT);
  });

  it("OWNER y STAFF pueden registrar; otra tienda es rechazada", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    await registerPayment({ orderId: order.id, amountCents: 30000, method: "CASH", paidAt: when }, staff, key(), prisma);
    const s = await getOrderPaymentSummary(order.id, staff, prisma);
    expect(s.paidCents).toBe(30000);
    const other = await commerceStore();
    expect(await authThrows(() => registerPayment({ orderId: order.id, amountCents: 1000, method: "CASH", paidAt: when }, other.owner, key(), prisma))).toBe(true);
  });

  it("comercio deshabilitado: el registro histórico continúa (requireEnabled:false)", async () => {
    const { storeId, owner, slug } = await commerceStore(true);
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    await setCommerceEnabled(slug, false, prisma);
    const p = await registerPayment({ orderId: order.id, amountCents: 50000, method: "TRANSFER", paidAt: when }, owner, key(), prisma);
    expect(p?.status).toBe("CONFIRMED");
  });

  it("pago sobre orden CANCELLED → ORDER_CANCELLED", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    await cancelStoreOrder(order.id, owner, null, prisma);
    expect(await retailCode(() => registerPayment({ orderId: order.id, amountCents: 10000, method: "CASH", paidAt: when }, owner, key(), prisma))).toBe(RETAIL_ERROR.ORDER_CANCELLED);
  });

  it("cancelar orden con pagos → ORDER_HAS_PAYMENTS (admin y cliente); con paidCents==0 se permite", async () => {
    const { storeId, owner } = await commerceStore();
    const paid = await reservedOrder(storeId, owner, 2, 50000);
    await registerPayment({ orderId: paid.order.id, amountCents: 10000, method: "CASH", paidAt: when }, owner, key(), prisma);
    expect(await retailCode(() => cancelStoreOrder(paid.order.id, owner, null, prisma))).toBe(RETAIL_ERROR.ORDER_HAS_PAYMENTS);
    expect(await retailCode(() => cancelCustomerOrder(paid.order.publicCode, paid.client, prisma))).toBe(RETAIL_ERROR.ORDER_HAS_PAYMENTS);
    // Sin pagos: la cancelación sigue permitida (cumple reglas previas de fulfillment).
    const free = await reservedOrder(storeId, owner, 1, 50000);
    const cancelled = await cancelStoreOrder(free.order.id, owner, null, prisma);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("cliente ve solo sus pagos CONFIRMED (monto/método/fecha), nunca nota ni actor; otro no ve la orden", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, client } = await reservedOrder(storeId, owner, 2, 50000);
    await registerPayment({ orderId: order.id, amountCents: 50000, method: "MERCADOPAGO", paidAt: when, note: "interno banco X" }, owner, key(), prisma);
    const view = await getCustomerOrder(order.publicCode, client, prisma);
    expect(view.paidCents).toBe(50000);
    expect(view.paymentStatus).toBe("PARTIALLY_PAID");
    expect(view.payments).toHaveLength(1);
    const p = view.payments[0];
    expect(p).toMatchObject({ amountCents: 50000, method: "MERCADOPAGO" });
    expect("note" in p).toBe(false);
    expect("confirmedByUserId" in p).toBe(false);
    const stranger = await user();
    expect(await retailCode(() => getCustomerOrder(order.publicCode, stranger, prisma))).toBe(RETAIL_ERROR.ORDER_ACCESS_DENIED);
  });

  it("actor eliminado preserva el pago (confirmedByUserId → SetNull)", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    const member = await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    const p = await registerPayment({ orderId: order.id, amountCents: 30000, method: "CASH", paidAt: when }, staff, key(), prisma);
    await prisma.storeMember.delete({ where: { id: member.id } });
    await prisma.user.delete({ where: { id: staff } });
    const kept = await prisma.storePayment.findUnique({ where: { id: p!.id }, select: { confirmedByUserId: true, amountCents: true } });
    expect(kept).toMatchObject({ confirmedByUserId: null, amountCents: 30000 });
  });

  it("FK Restrict: una orden con pagos no se borra", async () => {
    const { storeId, owner } = await commerceStore();
    const { order } = await reservedOrder(storeId, owner, 2, 50000);
    await registerPayment({ orderId: order.id, amountCents: 10000, method: "CASH", paidAt: when }, owner, key(), prisma);
    await expect(prisma.storeOrder.delete({ where: { id: order.id } })).rejects.toThrow();
  });

  it("resumen agregado por campaña excluye canceladas; listPendingPayments trae saldos", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const mkOffer = async () => { const v = await volume(1); return (await addPreorderOffer({ campaignId: c.id, volumeId: v, listPriceCents: 100000, preorderPriceCents: 50000 }, owner, prisma)).id; };
    const o1 = await mkOffer(); const o2 = await mkOffer(); const o3 = await mkOffer();
    await publishPreorderCampaign(c.id, owner, prisma);
    const mkOrder = async (offerId: number, qty: number) => { const u = await user(); return createStoreOrder({ campaignId: c.id, items: [{ offerId, quantity: qty }] }, u, prisma); };
    const full = await mkOrder(o1, 2);   // total 100000
    const part = await mkOrder(o2, 2);   // total 100000
    const cancd = await mkOrder(o3, 1);  // total 50000 → cancelada
    await registerPayment({ orderId: full.id, amountCents: 100000, method: "TRANSFER", paidAt: when }, owner, key(), prisma);
    await registerPayment({ orderId: part.id, amountCents: 40000, method: "CASH", paidAt: when }, owner, key(), prisma);
    await cancelStoreOrder(cancd.id, owner, null, prisma);

    const summary = await getCampaignPaymentSummary(c.id, owner, prisma);
    expect(summary.orderCount).toBe(2); // excluye la cancelada
    expect(summary.billedCents).toBe(200000);
    expect(summary.paidCents).toBe(140000);
    expect(summary.collectedPercent).toBe(70);
    expect(summary.byStatus).toMatchObject({ PAID: 1, PARTIALLY_PAID: 1, UNPAID: 0, OVERPAID: 0 });

    const pending = await listPendingPayments(c.id, owner, prisma);
    expect(pending.orders).toHaveLength(1);
    expect(pending.orders[0]).toMatchObject({ orderId: part.id, remainingCents: 60000 });

    const list = await listOrderPayments(full.id, owner, prisma);
    expect(list).toHaveLength(1);
  });
});
