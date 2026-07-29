/**
 * Integración de Retail — Avisos de llegada (Slice 5) contra Postgres REAL desechable (harness efímero; skip
 * sin `IDENTITY_TEST_DATABASE_URL`). Ejercita borradores, envío, cantidades informadas, concurrencia,
 * idempotencia/conflicto, permisos, privacidad cliente, cancelaciones, FKs, Merge y vista agregada.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember, setCommerceEnabled } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign, closePreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder, cancelStoreOrder, getCustomerOrder } from "@/lib/retail/orders";
import { markOrderLineArrived, getCampaignFulfillment } from "@/lib/retail/fulfillment";
import {
  getOrderArrivalNotificationPreview, createArrivalNotificationDraft, updateArrivalNotificationDraft,
  cancelArrivalNotification, markArrivalNotificationSent, listOrderNotifications, listPendingArrivalNotifications,
} from "@/lib/retail/notifications";
import { STORE_ROLE, StoreAuthError, STORE_AUTH_ERROR } from "@/lib/domain/store/authorize";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Avisos de llegada (Slice 5, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `nt-${Date.now()}-${seq++}`;
  const key = () => `sk-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@nt.dev`, name: `N-${seq}` }, select: { id: true } })).id;
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
  /** Orden con N líneas, cada una con `arrive` unidades llegadas. Devuelve ids. */
  async function arrivedOrder(storeId: number, owner: string, specs: Array<{ qty: number; arrive: number }>) {
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const items: { offerId: number }[] = [];
    for (const s of specs) {
      const { volumeId } = await volume(items.length + 1);
      const o = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: 100000, preorderPriceCents: 70000 }, owner, prisma);
      items.push({ offerId: o.id });
    }
    await publishPreorderCampaign(c.id, owner, prisma);
    const client = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: specs.map((s, i) => ({ offerId: items[i].offerId, quantity: s.qty })) }, client, prisma);
    for (let i = 0; i < specs.length; i++) if (specs[i].arrive > 0) await markOrderLineArrived(order.lines[i].id, specs[i].arrive, owner, key(), prisma);
    return { campaignId: c.id, order, client, lineIds: order.lines.map((l) => l.id) };
  }
  const retailCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; } };
  const authCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof StoreAuthError ? e.code : `X:${(e as Error).message}`; } };

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
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
    await prisma.user.deleteMany({ where: { email: { contains: "@nt.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("crear borrador (una y varias líneas) y editar mensaje", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 2 }, { qty: 1, arrive: 1 }]);
    const d1 = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    expect(d1.status).toBe("DRAFT");
    expect(d1.items).toHaveLength(1);
    const updated = await updateArrivalNotificationDraft(d1.id, "Mensaje editado", owner, prisma);
    expect(updated.messageSnapshot).toBe("Mensaje editado");
    const d2 = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 1 }, { orderLineId: lineIds[1], quantity: 1 }] }, owner, prisma);
    expect(d2.items).toHaveLength(2);
  });

  it("enviar → SENT con sentAt/sentBy; unidades informadas correctas", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 5 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 3 }] }, owner, prisma);
    const sent = await markArrivalNotificationSent(d.id, owner, key(), prisma);
    expect(sent?.status).toBe("SENT");
    expect(sent?.sentAt).toBeTruthy();
    expect(sent?.sentByUserId).toBe(owner);
    const preview = await getOrderArrivalNotificationPreview(order.id, owner, prisma);
    expect(preview.lines[0]).toMatchObject({ arrivedQuantity: 5, notifiedQuantity: 3, pendingUnnotified: 2 });
  });

  it("aviso parcial y aviso posterior por el resto", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 5 }]);
    const d1 = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 3 }] }, owner, prisma);
    await markArrivalNotificationSent(d1.id, owner, key(), prisma);
    const d2 = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    await markArrivalNotificationSent(d2.id, owner, key(), prisma);
    const preview = await getOrderArrivalNotificationPreview(order.id, owner, prisma);
    expect(preview.lines[0].pendingUnnotified).toBe(0);
  });

  it("no exceder llegadas al crear el borrador → ARRIVAL_NOTIFICATION_EXCEEDS_PENDING", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 2 }]);
    expect(await retailCode(() => createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 3 }] }, owner, prisma))).toBe(RETAIL_ERROR.ARRIVAL_NOTIFICATION_EXCEEDS_PENDING);
  });

  it("dos borradores que se solapan: el 2do al enviar → EXCEEDS_PENDING (validación definitiva)", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 3 }]);
    const a = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    const b = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma); // válido al crear (soft): quedaban 3
    await markArrivalNotificationSent(a.id, owner, key(), prisma); // informa 2 → queda 1 pendiente
    expect(await retailCode(() => markArrivalNotificationSent(b.id, owner, key(), prisma))).toBe(RETAIL_ERROR.ARRIVAL_NOTIFICATION_EXCEEDS_PENDING); // pide 2 > 1
  });

  it("doble submit con la MISMA sendOperationKey → idempotente (un solo SENT)", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 3 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 3 }] }, owner, prisma);
    const k = key();
    const s1 = await markArrivalNotificationSent(d.id, owner, k, prisma);
    const s2 = await markArrivalNotificationSent(d.id, owner, k, prisma); // retry misma key
    expect(s1?.id).toBe(s2?.id);
    expect(s2?.status).toBe("SENT");
    expect(await prisma.storeOrderNotification.count({ where: { id: d.id, status: "SENT" } })).toBe(1);
  });

  it("misma clave para OTRO aviso → NOTIFICATION_OPERATION_KEY_CONFLICT", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 4, arrive: 4 }]);
    const a = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 1 }] }, owner, prisma);
    const b = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 1 }] }, owner, prisma);
    const k = key();
    await markArrivalNotificationSent(a.id, owner, k, prisma);
    expect(await retailCode(() => markArrivalNotificationSent(b.id, owner, k, prisma))).toBe(RETAIL_ERROR.NOTIFICATION_OPERATION_KEY_CONFLICT);
  });

  it("permisos: STAFF opera; ya no un miembro de otra tienda → NOT_A_MEMBER", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, staff, prisma);
    await markArrivalNotificationSent(d.id, staff, key(), prisma);
    const outsider = (await commerceStore()).owner;
    expect(await authCode(() => getOrderArrivalNotificationPreview(order.id, outsider, prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
    expect(await authCode(() => listOrderNotifications(order.id, outsider, prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });

  it("cliente ve solo SENT (nunca DRAFT)", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, client, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 3, arrive: 3 }]);
    const draft = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 1 }] }, owner, prisma);
    let seen = await getCustomerOrder(order.publicCode, client, prisma);
    expect(seen.notifications).toHaveLength(0); // DRAFT no visible
    await markArrivalNotificationSent(draft.id, owner, key(), prisma);
    seen = await getCustomerOrder(order.publicCode, client, prisma);
    expect(seen.notifications).toHaveLength(1);
    expect(seen.notifications[0].messageSnapshot).toBeTruthy();
  });

  it("continúa con comercio deshabilitado y con campaña cerrada", async () => {
    const { storeId, owner, slug } = await commerceStore();
    const { campaignId, order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    await closePreorderCampaign(campaignId, owner, prisma);
    await setCommerceEnabled(slug, false, prisma);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    expect((await markArrivalNotificationSent(d.id, owner, key(), prisma))?.status).toBe("SENT");
  });

  it("campaña CANCELLED con llegada previa: se puede informar la orden existente", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    await prisma.preorderCampaign.update({ where: { id: campaignId }, data: { status: "CANCELLED" } });
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    expect((await markArrivalNotificationSent(d.id, owner, key(), prisma))?.status).toBe("SENT");
  });

  it("cancelar borrador → CANCELLED; cancelar orden con fulfillment iniciado sigue rechazada", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    expect((await cancelArrivalNotification(d.id, owner, prisma)).status).toBe("CANCELLED");
    expect(await retailCode(() => cancelStoreOrder(order.id, owner, null, prisma))).toBe(RETAIL_ERROR.ORDER_FULFILLMENT_STARTED); // hay unidades llegadas
  });

  it("cancelar orden (sin fulfillment) auto-cancela borradores DRAFT", async () => {
    const { storeId, owner } = await commerceStore();
    // orden sin llegadas; se inserta un DRAFT directo (borde defensivo) y se cancela la orden.
    const { order } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 0 }]);
    const draft = await prisma.storeOrderNotification.create({ data: { orderId: order.id, messageSnapshot: "hola", status: "DRAFT" }, select: { id: true } });
    await cancelStoreOrder(order.id, owner, null, prisma);
    expect((await prisma.storeOrderNotification.findUnique({ where: { id: draft.id }, select: { status: true } }))?.status).toBe("CANCELLED");
  });

  it("actor eliminado conserva el aviso (SetNull en sentBy)", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, staff, prisma);
    await markArrivalNotificationSent(d.id, staff, key(), prisma);
    await prisma.user.delete({ where: { id: staff } });
    const after = await prisma.storeOrderNotification.findUnique({ where: { id: d.id }, select: { status: true, sentByUserId: true, createdByUserId: true } });
    expect(after).toMatchObject({ status: "SENT", sentByUserId: null, createdByUserId: null });
  });

  it("FK Restrict: no se borra la orden ni la línea con avisos", async () => {
    const { storeId, owner } = await commerceStore();
    const { order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 2, arrive: 2 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 2 }] }, owner, prisma);
    await markArrivalNotificationSent(d.id, owner, key(), prisma);
    await expect(prisma.storeOrder.delete({ where: { id: order.id } })).rejects.toBeTruthy();
    await expect(prisma.storeOrderLine.delete({ where: { id: lineIds[0] } })).rejects.toBeTruthy();
  });

  it("Merge/reparent de Work no invalida los avisos", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const { volumeId, editionId } = await volume(1);
    const offer = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: 100000, preorderPriceCents: 70000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity: 2 }] }, await user(), prisma);
    await markOrderLineArrived(order.lines[0].id, 2, owner, key(), prisma);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: order.lines[0].id, quantity: 2 }] }, owner, prisma);
    await markArrivalNotificationSent(d.id, owner, key(), prisma);
    const survivor = await prisma.work.create({ data: { title: uniq(), normTitle: uniq(), type: "MANGA" }, select: { id: true } });
    await prisma.publisherEdition.update({ where: { id: editionId }, data: { workId: survivor.id } });
    expect(await prisma.storeOrderNotificationItem.count({ where: { notificationId: d.id } })).toBe(1);
  });

  it("vista agregada por oferta: informado y llegó-sin-informar", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, order, lineIds } = await arrivedOrder(storeId, owner, [{ qty: 5, arrive: 4 }]);
    const d = await createArrivalNotificationDraft({ orderId: order.id, items: [{ orderLineId: lineIds[0], quantity: 3 }] }, owner, prisma);
    await markArrivalNotificationSent(d.id, owner, key(), prisma);
    const agg = await getCampaignFulfillment(campaignId, owner, prisma);
    expect(agg.offers[0]).toMatchObject({ arrived: 4, notified: 3, arrivedNotInformed: 1 });
    const pend = await listPendingArrivalNotifications(campaignId, owner, prisma);
    expect(pend.orders).toHaveLength(1);
    expect(pend.orders[0].pendingUnnotified).toBe(1);
  });
});
