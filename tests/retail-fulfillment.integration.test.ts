/**
 * Integración de Retail — Cumplimiento (Slice 4) contra Postgres REAL desechable (harness efímero; skip sin
 * `IDENTITY_TEST_DATABASE_URL`). Ejercita las operaciones de línea con `actorUserId` explícito: pedido,
 * llegada parcial/total, cancelación parcial, idempotencia por operationKey, concurrencia, permisos,
 * historial, cancelación de orden/campaña con fulfillment iniciado, agregado por oferta y Merge.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember, setCommerceEnabled } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign, closePreorderCampaign, cancelPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder, cancelStoreOrder, getStoreOrder } from "@/lib/retail/orders";
import {
  markOrderLineOrdered, markOrderLineArrived, cancelOrderLineQuantity, getOrderLineHistory, getCampaignFulfillment,
} from "@/lib/retail/fulfillment";
import { STORE_ROLE, StoreAuthError, STORE_AUTH_ERROR } from "@/lib/domain/store/authorize";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Cumplimiento (Slice 4, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `ff-${Date.now()}-${seq++}`;
  const key = () => `op-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@ff.dev`, name: `N-${seq}` }, select: { id: true } })).id;
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
    return { volumeId: (await prisma.volume.create({ data: { editionId: e.id, number }, select: { id: true } })).id, workId: w.id, editionId: e.id };
  }
  /** Campaña publicada con 1 oferta + una orden del cliente con la cantidad pedida. Devuelve ids útiles. */
  async function orderWith(storeId: number, owner: string, quantity: number) {
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const { volumeId } = await volume(1);
    const offer = await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId, listPriceCents: 100000, preorderPriceCents: 70000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const client = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity }] }, client, prisma);
    return { campaignId: c.id, offerId: offer.id, order, client, lineId: order.lines[0].id };
  }
  const lineState = (id: number) => prisma.storeOrderLine.findUnique({ where: { id }, select: { fulfillmentStatus: true, orderedQuantity: true, arrivedQuantity: true, cancelledQuantity: true } });
  const retailCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; } };
  const authCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof StoreAuthError ? e.code : `X:${(e as Error).message}`; } };

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
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
    await prisma.user.deleteMany({ where: { email: { contains: "@ff.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("marcar pedido → ORDERED con orderedQuantity y orderedAt", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    await markOrderLineOrdered(lineId, 5, owner, key(), prisma);
    expect(await lineState(lineId)).toMatchObject({ fulfillmentStatus: "ORDERED", orderedQuantity: 5, arrivedQuantity: 0 });
    expect((await prisma.storeOrderLine.findUnique({ where: { id: lineId }, select: { orderedAt: true } }))?.orderedAt).toBeTruthy();
  });

  it("registrar llegada total → ARRIVED", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 3);
    await markOrderLineOrdered(lineId, 3, owner, key(), prisma);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma);
    expect(await lineState(lineId)).toMatchObject({ fulfillmentStatus: "ARRIVED", arrivedQuantity: 3 });
  });

  it("llegada parcial → sigue ORDERED; varias llegadas hasta completar → ARRIVED", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma); // directa (auto-ordena)
    expect(await lineState(lineId)).toMatchObject({ fulfillmentStatus: "ORDERED", arrivedQuantity: 3, orderedQuantity: 3 });
    await markOrderLineArrived(lineId, 2, owner, key(), prisma);
    expect(await lineState(lineId)).toMatchObject({ fulfillmentStatus: "ARRIVED", arrivedQuantity: 5 });
  });

  it("cancelar parcialmente unidades pendientes", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma);
    await cancelOrderLineQuantity(lineId, 2, "sin stock", owner, key(), prisma);
    expect(await lineState(lineId)).toMatchObject({ fulfillmentStatus: "ARRIVED", arrivedQuantity: 3, cancelledQuantity: 2 }); // 3+2=5 resuelto
  });

  it("no exceder la cantidad reservada → INVALID_FULFILLMENT_QUANTITY (rollback: sin cambios ni evento)", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 3);
    expect(await retailCode(() => markOrderLineArrived(lineId, 4, owner, key(), prisma))).toBe(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY);
    expect(await lineState(lineId)).toMatchObject({ arrivedQuantity: 0, orderedQuantity: 0 });
    expect(await prisma.storeOrderLineEvent.count({ where: { orderLineId: lineId } })).toBe(0);
  });

  it("idempotencia: retry con la misma operationKey aplica una sola vez", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    const k = key();
    await markOrderLineArrived(lineId, 2, owner, k, prisma);
    await markOrderLineArrived(lineId, 2, owner, k, prisma); // retry misma key
    expect(await lineState(lineId)).toMatchObject({ arrivedQuantity: 2 });
    expect(await prisma.storeOrderLineEvent.count({ where: { orderLineId: lineId } })).toBe(1);
  });

  it("misma key concurrente → un solo evento y una sola aplicación", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    const k = key();
    const mk = () => markOrderLineArrived(lineId, 2, owner, k, prisma);
    const [r1, r2] = await Promise.allSettled([mk(), mk()]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled"); // ambos ok (idempotente), pero...
    expect((await lineState(lineId))?.arrivedQuantity).toBe(2); // aplicado una sola vez
    expect(await prisma.storeOrderLineEvent.count({ where: { orderLineId: lineId } })).toBe(1); // un solo evento
  });

  it("misma key con payload diferente → OPERATION_KEY_CONFLICT sin modificar contadores", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    const k = key();
    await markOrderLineArrived(lineId, 2, owner, k, prisma);
    // misma key, otra cantidad
    expect(await retailCode(() => markOrderLineArrived(lineId, 3, owner, k, prisma))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
    // misma key, otro tipo
    expect(await retailCode(() => markOrderLineOrdered(lineId, 2, owner, k, prisma))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
    expect(await lineState(lineId)).toMatchObject({ arrivedQuantity: 2, orderedQuantity: 2 }); // sin cambios extra
    expect(await prisma.storeOrderLineEvent.count({ where: { orderLineId: lineId } })).toBe(1); // ningún evento nuevo
  });

  it("misma key en otra línea → OPERATION_KEY_CONFLICT (unicidad global)", async () => {
    const { storeId, owner } = await commerceStore();
    const a = await orderWith(storeId, owner, 3);
    const b = await orderWith(storeId, owner, 3);
    const k = key();
    await markOrderLineArrived(a.lineId, 1, owner, k, prisma);
    expect(await retailCode(() => markOrderLineArrived(b.lineId, 1, owner, k, prisma))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
    expect((await lineState(b.lineId))?.arrivedQuantity).toBe(0);
  });

  it("tras una operación exitosa, una clave NUEVA permite una segunda operación legítima", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 5);
    await markOrderLineArrived(lineId, 2, owner, key(), prisma);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma); // clave nueva = intento nuevo
    expect(await lineState(lineId)).toMatchObject({ arrivedQuantity: 5, fulfillmentStatus: "ARRIVED" });
    expect(await prisma.storeOrderLineEvent.count({ where: { orderLineId: lineId } })).toBe(2);
  });

  it("concurrencia en llegada: se serializa por el lock; no excede lo pendiente", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 3);
    const mk = () => markOrderLineArrived(lineId, 2, owner, key(), prisma);
    const [r1, r2] = await Promise.allSettled([mk(), mk()]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]); // 2 ok, el 2do excede (queda 1)
    expect((await lineState(lineId))?.arrivedQuantity).toBe(2);
  });

  it("permisos: OWNER y STAFF operan; miembro de otra tienda → NOT_A_MEMBER", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { lineId } = await orderWith(storeId, owner, 4);
    await markOrderLineOrdered(lineId, 2, owner, key(), prisma);
    await markOrderLineArrived(lineId, 1, staff, key(), prisma);
    expect((await lineState(lineId))?.arrivedQuantity).toBe(1);
    const outsider = (await commerceStore()).owner;
    expect(await authCode(() => markOrderLineArrived(lineId, 1, outsider, key(), prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });

  it("cliente (no miembro) no puede operar → NOT_A_MEMBER", async () => {
    const { storeId, owner } = await commerceStore();
    const { lineId, client } = await orderWith(storeId, owner, 3);
    expect(await authCode(() => markOrderLineOrdered(lineId, 1, client, key(), prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });

  it("la operación continúa con el comercio deshabilitado", async () => {
    const { storeId, owner, slug } = await commerceStore();
    const { lineId } = await orderWith(storeId, owner, 3);
    await setCommerceEnabled(slug, false, prisma);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma);
    expect((await lineState(lineId))?.fulfillmentStatus).toBe("ARRIVED");
  });

  it("la operación continúa después de CERRAR la campaña", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, lineId } = await orderWith(storeId, owner, 3);
    await closePreorderCampaign(campaignId, owner, prisma);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma);
    expect((await lineState(lineId))?.fulfillmentStatus).toBe("ARRIVED");
  });

  it("rechaza pedido/llegada sobre campaña CANCELLED", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, lineId } = await orderWith(storeId, owner, 3);
    await prisma.preorderCampaign.update({ where: { id: campaignId }, data: { status: "CANCELLED" } }); // fuerza estado
    expect(await retailCode(() => markOrderLineOrdered(lineId, 1, owner, key(), prisma))).toBe(RETAIL_ERROR.ORDER_LINE_OPERATION_NOT_ALLOWED);
  });

  it("cancelación de orden antes de fulfillment cancela sus líneas", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineId } = await orderWith(storeId, owner, 3);
    await cancelStoreOrder(order.id, owner, "cliente se arrepintió", prisma);
    expect(await lineState(lineId)).toMatchObject({ fulfillmentStatus: "CANCELLED", cancelledQuantity: 3 });
  });

  it("rechaza cancelar la orden si el fulfillment ya comenzó → ORDER_FULFILLMENT_STARTED", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineId } = await orderWith(storeId, owner, 3);
    await markOrderLineOrdered(lineId, 1, owner, key(), prisma);
    expect(await retailCode(() => cancelStoreOrder(order.id, owner, null, prisma))).toBe(RETAIL_ERROR.ORDER_FULFILLMENT_STARTED);
  });

  it("cancelar campaña con órdenes activas → CAMPAIGN_HAS_ACTIVE_ORDERS", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId } = await orderWith(storeId, owner, 3);
    expect(await retailCode(() => cancelPreorderCampaign(campaignId, owner, prisma))).toBe(RETAIL_ERROR.CAMPAIGN_HAS_ACTIVE_ORDERS);
  });

  it("vista agregada por oferta suma la demanda", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, lineId } = await orderWith(storeId, owner, 5);
    await markOrderLineOrdered(lineId, 4, owner, key(), prisma);
    await markOrderLineArrived(lineId, 3, owner, key(), prisma);
    await cancelOrderLineQuantity(lineId, 1, null, owner, key(), prisma);
    const agg = await getCampaignFulfillment(campaignId, owner, prisma);
    expect(agg.offers).toHaveLength(1);
    expect(agg.offers[0]).toMatchObject({ reserved: 5, ordered: 4, arrived: 3, cancelled: 1, pending: 1 });
  });

  it("historial ordenado; el actor eliminado conserva el evento (SetNull)", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { lineId } = await orderWith(storeId, owner, 3);
    await markOrderLineOrdered(lineId, 3, staff, key(), prisma);
    await markOrderLineArrived(lineId, 3, staff, key(), prisma);
    const hist = await getOrderLineHistory(lineId, owner, prisma);
    expect(hist.map((h) => h.type)).toEqual(["MARKED_ORDERED", "MARKED_ARRIVED"]);
    await prisma.user.delete({ where: { id: staff } }); // borra membresía (cascade) y deja eventos (SetNull)
    const after = await prisma.storeOrderLineEvent.findMany({ where: { orderLineId: lineId }, select: { actorUserId: true } });
    expect(after).toHaveLength(2);
    expect(after.every((e) => e.actorUserId === null)).toBe(true);
  });

  it("Merge/reparent de Work no invalida líneas ni eventos", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const { volumeId, editionId } = await volume(2);
    const offer = await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId, listPriceCents: 100000, preorderPriceCents: 70000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity: 2 }] }, await user(), prisma);
    const lineId = order.lines[0].id;
    await markOrderLineArrived(lineId, 1, owner, key(), prisma);
    const survivor = await prisma.work.create({ data: { title: uniq(), normTitle: uniq(), type: "MANGA" }, select: { id: true } });
    await prisma.publisherEdition.update({ where: { id: editionId }, data: { workId: survivor.id } });
    expect((await lineState(lineId))?.arrivedQuantity).toBe(1);
    expect(await prisma.storeOrderLineEvent.count({ where: { orderLineId: lineId } })).toBe(1);
  });
});
