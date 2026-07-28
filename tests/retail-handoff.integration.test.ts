/**
 * Integración de Retail — Preparación y retiro (Slice 7) contra Postgres REAL desechable (harness efímero;
 * skip sin `IDENTITY_TEST_DATABASE_URL`). Ejercita preparación/retiro parcial y múltiple, límites, idempotencia
 * individual y masiva (payload inmutable), concurrencia, interacción con Slice 4 (arrival/cancel) y Slice 6
 * (pago sin gate), permisos, privacidad, atomicidad de lote y ausencia de escritura en colección.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember, setCommerceEnabled } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder, cancelStoreOrder, getStoreOrder, getCustomerOrder } from "@/lib/retail/orders";
import { markOrderLineArrived, cancelOrderLineQuantity } from "@/lib/retail/fulfillment";
import { prepareOrderLine, pickupOrderLine, prepareOrderLines, pickupOrderLines, getCampaignHandoff } from "@/lib/retail/handoff";
import { registerPayment } from "@/lib/retail/payments";
import { STORE_ROLE, StoreAuthError } from "@/lib/domain/store/authorize";
import { LINE_EVENT_TYPE } from "@/lib/domain/retail/fulfillment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Preparación y retiro (Slice 7, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `hf-${Date.now()}-${seq++}`;
  const key = () => `hk-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@hf.dev`, name: `H-${seq}` }, select: { id: true } })).id;
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
  /** Orden con líneas `{qty, arrive}`; marca las llegadas. Devuelve ids. */
  async function arrivedOrder(storeId: number, owner: string, specs: Array<{ qty: number; arrive: number }>, price = 50000) {
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const offerIds: number[] = [];
    for (let i = 0; i < specs.length; i++) {
      const volumeId = await volume(i + 1);
      const o = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: price * 2, preorderPriceCents: price }, owner, prisma);
      offerIds.push(o.id);
    }
    await publishPreorderCampaign(c.id, owner, prisma);
    const client = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: specs.map((s, i) => ({ offerId: offerIds[i], quantity: s.qty })) }, client, prisma);
    for (let i = 0; i < specs.length; i++) if (specs[i].arrive > 0) await markOrderLineArrived(order.lines[i].id, specs[i].arrive, owner, key(), prisma);
    return { campaignId: c.id, order, client, lineIds: order.lines.map((l) => l.id) };
  }
  const countsOf = async (lineId: number) => prisma.storeOrderLine.findUnique({ where: { id: lineId }, select: { arrivedQuantity: true, preparedQuantity: true, pickedUpQuantity: true } });
  /** Eventos del ledger de UNA línea (acotado por orderLineId y, opcionalmente, tipo). Evidencia directa. */
  const eventsOf = async (lineId: number, type?: string) =>
    prisma.storeOrderLineEvent.findMany({
      where: { orderLineId: lineId, ...(type ? { type } : {}) },
      select: { id: true, type: true, quantity: true, orderLineId: true, operationKey: true, note: true },
      orderBy: { id: "asc" },
    });
  /** Cuenta eventos cuya operationKey deriva de un batch (`${bk}:...`); precisa (sufijo `:` evita prefijos ambiguos). */
  const batchEventCount = async (bk: string) => prisma.storeOrderLineEvent.count({ where: { operationKey: { startsWith: `${bk}:` } } });
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
    await prisma.user.deleteMany({ where: { email: { contains: "@hf.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("preparación parcial + preparaciones múltiples; retiro parcial + retiros múltiples", async () => {
    const { owner, storeId } = await commerceStore();
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 5 }]);
    await prepareOrderLine(lineIds[0], 2, owner, key(), prisma);
    await prepareOrderLine(lineIds[0], 3, owner, key(), prisma);
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 5 });
    await pickupOrderLine(lineIds[0], 1, owner, key(), prisma);
    await pickupOrderLine(lineIds[0], 2, owner, key(), prisma);
    expect(await countsOf(lineIds[0])).toMatchObject({ pickedUpQuantity: 3 });
    // Ledger directo: un evento por operación, tipo correcto, cantidad registrada = delta, sin duplicados.
    const prep = await eventsOf(lineIds[0], LINE_EVENT_TYPE.PREPARED);
    expect(prep).toHaveLength(2);
    expect(prep.every((e) => e.type === "PREPARED" && e.orderLineId === lineIds[0])).toBe(true);
    expect(prep.map((e) => e.quantity).sort((a, b) => a - b)).toEqual([2, 3]);
    const pick = await eventsOf(lineIds[0], LINE_EVENT_TYPE.PICKED_UP);
    expect(pick).toHaveLength(2);
    expect(pick.every((e) => e.type === "PICKED_UP" && e.orderLineId === lineIds[0])).toBe(true);
    expect(pick.map((e) => e.quantity).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("límites: preparar > llegado, retirar > preparado, nada para preparar/retirar", async () => {
    const { owner, storeId } = await commerceStore();
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 2 }]);
    expect(await retailCode(() => prepareOrderLine(lineIds[0], 3, owner, key(), prisma))).toBe(RETAIL_ERROR.PREPARATION_EXCEEDS_ARRIVED);
    await prepareOrderLine(lineIds[0], 2, owner, key(), prisma);
    expect(await retailCode(() => prepareOrderLine(lineIds[0], 1, owner, key(), prisma))).toBe(RETAIL_ERROR.NOTHING_TO_PREPARE);
    expect(await retailCode(() => pickupOrderLine(lineIds[0], 3, owner, key(), prisma))).toBe(RETAIL_ERROR.PICKUP_EXCEEDS_PREPARED);
    await pickupOrderLine(lineIds[0], 2, owner, key(), prisma);
    expect(await retailCode(() => pickupOrderLine(lineIds[0], 1, owner, key(), prisma))).toBe(RETAIL_ERROR.NOTHING_TO_PICKUP);
  });

  it("doble submit misma clave+payload → idempotente (no duplica); misma clave distinto payload → conflicto", async () => {
    const { owner, storeId } = await commerceStore();
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 5 }]);
    const k = key();
    await prepareOrderLine(lineIds[0], 2, owner, k, prisma);
    await prepareOrderLine(lineIds[0], 2, owner, k, prisma); // retry idempotente
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 2 });
    // Ledger: el retry NO duplica → exactamente 1 evento PREPARED con esa key, línea y cantidad.
    const afterRetry = await eventsOf(lineIds[0], LINE_EVENT_TYPE.PREPARED);
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0]).toMatchObject({ type: "PREPARED", orderLineId: lineIds[0], quantity: 2, operationKey: k });
    // Conflicto de payload (misma key, distinta cantidad): el evento original queda intacto; nada nuevo.
    expect(await retailCode(() => prepareOrderLine(lineIds[0], 3, owner, k, prisma))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
    const afterConflict = await eventsOf(lineIds[0], LINE_EVENT_TYPE.PREPARED);
    expect(afterConflict).toHaveLength(1);
    expect(afterConflict[0]).toMatchObject({ quantity: 2, operationKey: k }); // cantidad original conservada
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 2 }); // contador sin cambios
  });

  it("retiro idempotente: retry idéntico → exactamente 1 evento PICKED_UP (note null), contador correcto", async () => {
    const { owner, storeId } = await commerceStore();
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 5 }]);
    await prepareOrderLine(lineIds[0], 3, owner, key(), prisma);
    const k = key();
    await pickupOrderLine(lineIds[0], 2, owner, k, prisma);
    await pickupOrderLine(lineIds[0], 2, owner, k, prisma); // retry idempotente
    expect(await countsOf(lineIds[0])).toMatchObject({ pickedUpQuantity: 2 });
    const evs = await eventsOf(lineIds[0], LINE_EVENT_TYPE.PICKED_UP);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: "PICKED_UP", orderLineId: lineIds[0], quantity: 2, operationKey: k, note: null });
  });

  it("dos empleados concurrentes (claves distintas) → proyección correcta sin romper invariante", async () => {
    const { owner, storeId, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 6, arrive: 6 }]);
    await Promise.all([prepareOrderLine(lineIds[0], 3, owner, key(), prisma), prepareOrderLine(lineIds[0], 3, staff, key(), prisma)]);
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 6 });
  });

  it("interacción Slice 4: arrival después de preparar; cancel del pending no afecta prepared/pickedUp", async () => {
    const { owner, storeId } = await commerceStore();
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 2 }]);
    await prepareOrderLine(lineIds[0], 2, owner, key(), prisma);
    await pickupOrderLine(lineIds[0], 1, owner, key(), prisma);
    await markOrderLineArrived(lineIds[0], 3, owner, key(), prisma); // llegan 3 más (arrived → 5)
    expect(await countsOf(lineIds[0])).toMatchObject({ arrivedQuantity: 5, preparedQuantity: 2, pickedUpQuantity: 1 });
    // cancelar el pending no toca lo llegado/preparado/retirado (acá pending = 0 tras la 2da llegada)
    const { lineIds: l2 } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 2 }]);
    await prepareOrderLine(l2[0], 2, owner, key(), prisma);
    await cancelOrderLineQuantity(l2[0], 3, null, owner, key(), prisma); // cancela los 3 pendientes
    expect(await countsOf(l2[0])).toMatchObject({ arrivedQuantity: 2, preparedQuantity: 2 });
    await pickupOrderLine(l2[0], 2, owner, key(), prisma);
    expect(await countsOf(l2[0])).toMatchObject({ pickedUpQuantity: 2 }); // orden completa (2 llegado retirado, 3 cancelado)
  });

  it("masiva: payload explícito; individual vs masiva; atomicidad si falla un item", async () => {
    const { owner, storeId } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 3 }, { qty: 2, arrive: 2 }]);
    await prepareOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 3 }, { orderLineId: lineIds[1], quantity: 2 }], owner, key(), prisma);
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 3 });
    expect(await countsOf(lineIds[1])).toMatchObject({ preparedQuantity: 2 });
    // atomicidad: un item inválido (retirar > preparado en línea 1) revierte TODO el lote
    const fk = key();
    expect(await retailCode(() => pickupOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 1 }, { orderLineId: lineIds[1], quantity: 5 }], owner, fk, prisma))).toBe(RETAIL_ERROR.PICKUP_EXCEEDS_PREPARED);
    // Contadores intactos en AMBAS líneas y CERO efectos del batch: ni evento PICKED_UP ni key derivada persistida.
    expect(await countsOf(lineIds[0])).toMatchObject({ pickedUpQuantity: 0 });
    expect(await countsOf(lineIds[1])).toMatchObject({ pickedUpQuantity: 0 });
    expect(await batchEventCount(fk)).toBe(0); // ninguna clave derivada del batch quedó persistida
    expect(await eventsOf(lineIds[0], LINE_EVENT_TYPE.PICKED_UP)).toHaveLength(0);
    expect(await eventsOf(lineIds[1], LINE_EVENT_TYPE.PICKED_UP)).toHaveLength(0);
  });

  it("retry masivo inmutable: tras nuevas llegadas / otra preparación, mismo key+payload es no-op; distinto payload → conflicto", async () => {
    const { owner, storeId } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 2 }]);
    const bk = key();
    await prepareOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 2 }], owner, bk, prisma);
    await markOrderLineArrived(lineIds[0], 3, owner, key(), prisma); // llegan 3 más
    await prepareOrderLine(lineIds[0], 1, owner, key(), prisma); // otra preparación individual (prepared → 3)
    const eventsBeforeRetry = await batchEventCount(bk); // 1 evento del batch (por item)
    await prepareOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 2 }], owner, bk, prisma); // retry mismo lote → no-op
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 3 }); // no recalcula el alcance
    // Ledger: retry del mismo batch = CERO eventos nuevos, aunque cambiaron los contadores entre intentos.
    expect(eventsBeforeRetry).toBe(1);
    expect(await batchEventCount(bk)).toBe(1);
    // Per-item: exactamente 1 evento con la key derivada correcta y cantidad = delta original del payload.
    const itemEvents = await prisma.storeOrderLineEvent.findMany({ where: { operationKey: `${bk}:prepare:${lineIds[0]}` }, select: { type: true, quantity: true, orderLineId: true } });
    expect(itemEvents).toHaveLength(1);
    expect(itemEvents[0]).toMatchObject({ type: "PREPARED", quantity: 2, orderLineId: lineIds[0] });
    expect(await retailCode(() => prepareOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 5 }], owner, bk, prisma))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
  });

  it("masiva: lote vacío, líneas duplicadas, línea de otra orden", async () => {
    const { owner, storeId } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 3 }]);
    expect(await retailCode(() => prepareOrderLines(order.id, [], owner, key(), prisma))).toBe(RETAIL_ERROR.EMPTY_HANDOFF_BATCH);
    expect(await retailCode(() => prepareOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 1 }, { orderLineId: lineIds[0], quantity: 1 }], owner, key(), prisma))).toBe(RETAIL_ERROR.DUPLICATE_HANDOFF_ITEM);
    const other = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    expect(await retailCode(() => prepareOrderLines(order.id, [{ orderLineId: other.lineIds[0], quantity: 1 }], owner, key(), prisma))).toBe(RETAIL_ERROR.ORDER_LINE_NOT_FOUND);
  });

  it("permisos: STAFF ok; otra tienda rechazada; comercio deshabilitado continúa", async () => {
    const { owner, storeId, profileId, slug } = await commerceStore(true);
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 4, arrive: 4 }]);
    await prepareOrderLine(lineIds[0], 2, staff, key(), prisma); // STAFF
    const other = await commerceStore();
    expect(await authThrows(() => prepareOrderLine(lineIds[0], 1, other.owner, key(), prisma))).toBe(true); // otra tienda
    await setCommerceEnabled(slug, false, prisma);
    await prepareOrderLine(lineIds[0], 2, owner, key(), prisma); // requireEnabled:false → continúa
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 4 });
  });

  it("orden cancelada rechaza preparar/retirar", async () => {
    const { owner, storeId } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 0 }]); // sin llegadas → cancelable
    await cancelStoreOrder(order.id, owner, null, prisma);
    expect(await retailCode(() => prepareOrderLine(lineIds[0], 1, owner, key(), prisma))).toBe(RETAIL_ERROR.ORDER_CANCELLED);
    expect(await retailCode(() => prepareOrderLines(order.id, [{ orderLineId: lineIds[0], quantity: 1 }], owner, key(), prisma))).toBe(RETAIL_ERROR.ORDER_CANCELLED);
  });

  it("pago sin gate: UNPAID / PARTIALLY / PAID / OVERPAID permiten retirar; sin escritura en colección", async () => {
    const { owner, storeId } = await commerceStore();
    const setups: Array<number | null> = [null, 20000, 50000, 60000]; // UNPAID, PARTIALLY, PAID, OVERPAID (total 50000)
    for (const pay of setups) {
      const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 1, arrive: 1 }], 50000);
      await prepareOrderLine(lineIds[0], 1, owner, key(), prisma);
      if (pay != null) await registerPayment({ orderId: order.id, amountCents: pay, method: "TRANSFER", paidAt: new Date() }, owner, key(), prisma);
      await pickupOrderLine(lineIds[0], 1, owner, key(), prisma); // procede sin importar el pago
      expect(await countsOf(lineIds[0])).toMatchObject({ pickedUpQuantity: 1 });
    }
    expect(await prisma.ownedVolume.count()).toBe(0);
    expect(await prisma.purchase.count()).toBe(0);
  });

  it("lecturas: admin y cliente ven contadores; cliente no ve eventos internos; aislamiento", async () => {
    const { owner, storeId } = await commerceStore();
    const { order, client, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 4, arrive: 4 }]);
    await prepareOrderLine(lineIds[0], 4, owner, key(), prisma);
    await pickupOrderLine(lineIds[0], 2, owner, key(), prisma);
    const admin = await getStoreOrder(order.id, owner, prisma);
    expect(admin.lines[0]).toMatchObject({ preparedQuantity: 4, pickedUpQuantity: 2 });
    const view = await getCustomerOrder(order.publicCode, client, prisma);
    expect(view.lines[0]).toMatchObject({ preparedQuantity: 4, pickedUpQuantity: 2 });
    expect("events" in view.lines[0]).toBe(false); // el cliente no ve el ledger interno
    const stranger = await user();
    expect(await retailCode(() => getCustomerOrder(order.publicCode, stranger, prisma))).toBe(RETAIL_ERROR.ORDER_ACCESS_DENIED);
  });

  it("vista agregada por campaña (solo órdenes activas)", async () => {
    const { owner, storeId } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const volumeId = await volume(1);
    const offer = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: 100000, preorderPriceCents: 50000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const u = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity: 5 }] }, u, prisma);
    await markOrderLineArrived(order.lines[0].id, 5, owner, key(), prisma);
    await prepareOrderLine(order.lines[0].id, 4, owner, key(), prisma);
    await pickupOrderLine(order.lines[0].id, 2, owner, key(), prisma);
    const data = await getCampaignHandoff(c.id, owner, prisma);
    expect(data.offers).toHaveLength(1);
    expect(data.offers[0]).toMatchObject({ reserved: 5, arrived: 5, prepared: 4, pickedUp: 2, readyForPickup: 2 });
  });

  it("migración sobre datos existentes: líneas nuevas nacen con contadores en 0", async () => {
    const { owner, storeId } = await commerceStore();
    const { lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 0 }]);
    expect(await countsOf(lineIds[0])).toMatchObject({ preparedQuantity: 0, pickedUpQuantity: 0 });
  });
});
