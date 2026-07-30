/**
 * Integración de Retail — Reservas / StoreOrder (Slice 3) contra Postgres REAL desechable (harness efímero;
 * skip sin `IDENTITY_TEST_DATABASE_URL`). Ejercita los SERVICIOS con `actorUserId` explícito (sin `auth()`):
 * creación transaccional, precios/snapshots congelados, validaciones, concurrencia, privacidad/aislamiento,
 * cancelación, FKs y compatibilidad con Merge.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember, setCommerceEnabled, updateCommerceData } from "@/lib/storeCommerce";
import { registerPayment } from "@/lib/retail/payments";
import { createPreorderCampaign, publishPreorderCampaign, closePreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer, hidePreorderOffer } from "@/lib/retail/offers";
import {
  createStoreOrder, listCustomerOrders, getCustomerOrder, cancelCustomerOrder,
  listStoreOrders, getStoreOrder, cancelStoreOrder,
} from "@/lib/retail/orders";
import { STORE_ROLE, StoreAuthError, STORE_AUTH_ERROR } from "@/lib/domain/store/authorize";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Reservas (Slice 3, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `ro-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@ro.dev`, name: `N-${seq}` }, select: { id: true } })).id;
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
    const v = await prisma.volume.create({ data: { editionId: e.id, number, isbn: `978-${number}` }, select: { id: true } });
    return { volumeId: v.id, workId: w.id, editionId: e.id };
  }
  /** Campaña PUBLISHED abierta con N ofertas; devuelve ids de campaña y ofertas. */
  async function openCampaign(storeId: number, owner: string, prices: Array<{ list: number; pre: number }>, dates?: { opensAt?: Date; closesAt?: Date }) {
    const c = await createPreorderCampaign({ storeId, title: uniq(), opensAt: dates?.opensAt ?? null, closesAt: dates?.closesAt ?? null }, owner, prisma);
    const offerIds: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      const { volumeId } = await volume(i + 1);
      const o = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: prices[i].list, preorderPriceCents: prices[i].pre }, owner, prisma);
      offerIds.push(o.id);
    }
    await publishPreorderCampaign(c.id, owner, prisma);
    return { campaignId: c.id, offerIds };
  }
  const retailCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; } };
  const authCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof StoreAuthError ? e.code : `X:${(e as Error).message}`; } };

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.storePayment.deleteMany({}); // Restrict → borrar antes que la orden
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
    await prisma.user.deleteMany({ where: { email: { contains: "@ro.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- creación --------------------------------------------------------------
  it("crea orden con una oferta → RESERVED, publicCode, total y línea con snapshot", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const client = await user();
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 2 }] }, client, prisma);
    expect(order.status).toBe("RESERVED");
    expect(order.publicCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{6}$/);
    expect(order.totalCents).toBe(140000);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ quantity: 2, unitListPriceCents: 100000, unitPreorderPriceCents: 70000, lineTotalCents: 140000 });
    expect(order.lines[0].titleSnapshot).toBeTruthy();
    expect(order.customerEmailSnapshot).toContain("@ro.dev");
  });

  it("getCustomerOrder expone datos de exhibición de la tienda (checkoutMode/whatsapp/alias/instrucciones) y NO filtra la nota interna del pago", async () => {
    const { storeId, owner, slug } = await commerceStore();
    await updateCommerceData(
      slug,
      { whatsapp: "+5491155550000", paymentAlias: "mi.alias", paymentInstructions: "Transferí y avisá" },
      prisma,
    );
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 90000 }]);
    const client = await user();
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, client, prisma);
    await registerPayment(
      { orderId: order.id, amountCents: 90000, method: "TRANSFER", paidAt: new Date(), note: "secreto interno" },
      owner,
      `${uniq()}-pay`,
      prisma,
    );

    const view = await getCustomerOrder(order.publicCode, client, prisma);
    expect(view.store.commerceProfile).toMatchObject({
      checkoutMode: "CONVERSATIONAL",
      whatsapp: "+5491155550000",
      paymentAlias: "mi.alias",
      paymentInstructions: "Transferí y avisá",
    });
    expect(view.paymentStatus).toBe("PAID");
    expect(view.payments).toHaveLength(1);
    expect(view.payments[0]).not.toHaveProperty("note"); // la nota interna nunca llega al comprador
  });

  it("crea orden con varias ofertas → total = suma", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }, { list: 50000, pre: 50000 }]);
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }, { offerId: offerIds[1], quantity: 3 }] }, await user(), prisma);
    expect(order.lines).toHaveLength(2);
    expect(order.totalCents).toBe(70000 + 150000);
  });

  it("copia precios/snapshots de la oferta y NO se re-resuelve del catálogo", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const { volumeId, workId } = await volume(4);
    const offer = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: 90000, preorderPriceCents: 60000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity: 1 }] }, await user(), prisma);
    const snap = order.lines[0].titleSnapshot;
    // cambiar el catálogo después no altera la línea histórica
    await prisma.work.update({ where: { id: workId }, data: { title: "TITULO NUEVO", normTitle: "titulo nuevo" } });
    const reloaded = await prisma.storeOrderLine.findFirst({ where: { orderId: order.id } });
    expect(reloaded?.titleSnapshot).toBe(snap);
    expect(reloaded?.titleSnapshot).not.toBe("TITULO NUEVO");
  });

  it("rechaza total manipulado por el cliente → ORDER_TOTAL_MISMATCH", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }], expectedTotalCents: 1 }, await user(), prisma))).toBe(RETAIL_ERROR.ORDER_TOTAL_MISMATCH);
  });

  it("lista vacía → EMPTY_ORDER; cantidad inválida → INVALID_QUANTITY; exceso → TOO_MANY_ITEMS", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [] }, await user(), prisma))).toBe(RETAIL_ERROR.EMPTY_ORDER);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 0 }] }, await user(), prisma))).toBe(RETAIL_ERROR.INVALID_QUANTITY);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 21 }] }, await user(), prisma))).toBe(RETAIL_ERROR.TOO_MANY_ITEMS);
  });

  it("consolida oferta duplicada en UNA línea sumando cantidades", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 2 }, { offerId: offerIds[0], quantity: 3 }] }, await user(), prisma);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].quantity).toBe(5);
  });

  it("oferta de otra campaña → OFFER_CAMPAIGN_MISMATCH (rollback: sin orden)", async () => {
    const { storeId, owner } = await commerceStore();
    const a = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const b = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const client = await user();
    expect(await retailCode(async () => createStoreOrder({ campaignId: a.campaignId, items: [{ offerId: a.offerIds[0], quantity: 1 }, { offerId: b.offerIds[0], quantity: 1 }] }, client, prisma))).toBe(RETAIL_ERROR.OFFER_CAMPAIGN_MISMATCH);
    expect(await prisma.storeOrder.count({ where: { campaignId: a.campaignId } })).toBe(0); // rollback total
  });

  it("oferta oculta → OFFER_NOT_AVAILABLE", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    await hidePreorderOffer(offerIds[0], owner, prisma);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, await user(), prisma))).toBe(RETAIL_ERROR.OFFER_NOT_AVAILABLE);
  });

  it("campaña cerrada → CAMPAIGN_NOT_OPEN", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    await closePreorderCampaign(campaignId, owner, prisma);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, await user(), prisma))).toBe(RETAIL_ERROR.CAMPAIGN_NOT_OPEN);
  });

  it("campaña fuera de fechas (aún no abre) → CAMPAIGN_NOT_OPEN", async () => {
    const { storeId, owner } = await commerceStore();
    const future = new Date(Date.now() + 86400000);
    const later = new Date(Date.now() + 2 * 86400000);
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }], { opensAt: future, closesAt: later });
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, await user(), prisma))).toBe(RETAIL_ERROR.CAMPAIGN_NOT_OPEN);
  });

  it("comercio deshabilitado tras publicar → STORE_COMMERCE_DISABLED", async () => {
    const { storeId, owner, slug } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    await setCommerceEnabled(slug, false, prisma);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, await user(), prisma))).toBe(RETAIL_ERROR.STORE_COMMERCE_DISABLED);
  });

  // --- unicidad / concurrencia ----------------------------------------------
  it("doble submit concurrente del mismo usuario → una sola orden (idempotente)", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const client = await user();
    const mk = () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, client, prisma);
    const [r1, r2] = await Promise.allSettled([mk(), mk()]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
    expect(await prisma.storeOrder.count({ where: { campaignId, userId: client } })).toBe(1);
  });

  it("una orden por usuario/campaña: segundo intento devuelve la existente; tras cancelar → ORDER_ALREADY_EXISTS", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const client = await user();
    const first = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, client, prisma);
    const second = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 2 }] }, client, prisma);
    expect(second.id).toBe(first.id); // inmutable: no crea otra ni cambia cantidades
    await cancelCustomerOrder(first.publicCode, client, prisma);
    expect(await retailCode(async () => createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, client, prisma))).toBe(RETAIL_ERROR.ORDER_ALREADY_EXISTS);
  });

  // --- privacidad / aislamiento ---------------------------------------------
  it("lectura por el propietario; rechazo a otro cliente → ORDER_ACCESS_DENIED", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const client = await user();
    const other = await user();
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, client, prisma);
    expect((await getCustomerOrder(order.publicCode, client, prisma)).id).toBe(order.id);
    expect(await retailCode(() => getCustomerOrder(order.publicCode, other, prisma))).toBe(RETAIL_ERROR.ORDER_ACCESS_DENIED);
    expect((await listCustomerOrders(client, prisma)).length).toBe(1);
    expect((await listCustomerOrders(other, prisma)).length).toBe(0);
  });

  it("lectura por OWNER/STAFF de la tienda; miembro de otra tienda → NOT_A_MEMBER", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, await user(), prisma);
    expect((await getStoreOrder(order.id, owner, prisma)).id).toBe(order.id);
    expect((await getStoreOrder(order.id, staff, prisma)).id).toBe(order.id);
    const outsider = (await commerceStore()).owner;
    expect(await authCode(() => getStoreOrder(order.id, outsider, prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
    expect(await authCode(() => listStoreOrders(campaignId, outsider, prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });

  // --- cancelación -----------------------------------------------------------
  it("cancela por cliente y por tienda; no se cancela dos veces", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const c1 = await user();
    const o1 = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, c1, prisma);
    expect((await cancelCustomerOrder(o1.publicCode, c1, prisma)).status).toBe("CANCELLED");
    expect(await retailCode(() => cancelCustomerOrder(o1.publicCode, c1, prisma))).toBe(RETAIL_ERROR.ORDER_NOT_CANCELLABLE); // dos veces

    const c2 = await user();
    const o2 = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, c2, prisma);
    const cancelled = await cancelStoreOrder(o2.id, owner, "sin stock", prisma);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledByUserId).toBe(owner);
    expect(await retailCode(() => cancelStoreOrder(o2.id, owner, null, prisma))).toBe(RETAIL_ERROR.ORDER_NOT_CANCELLABLE);
  });

  // --- FKs / historial / Merge ----------------------------------------------
  it("FK Restrict: no se borra Store, Campaign, Offer ni Volume con órdenes/líneas", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const { volumeId } = await volume(1);
    const offer = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: 100000, preorderPriceCents: 70000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity: 1 }] }, await user(), prisma);
    await expect(prisma.store.delete({ where: { id: storeId } })).rejects.toBeTruthy();
    await expect(prisma.preorderCampaign.delete({ where: { id: c.id } })).rejects.toBeTruthy();
    await expect(prisma.preorderOffer.delete({ where: { id: offer.id } })).rejects.toBeTruthy();
    await expect(prisma.volume.delete({ where: { id: volumeId } })).rejects.toBeTruthy();
  });

  it("borrar el User preserva la orden (SetNull en userId)", async () => {
    const { storeId, owner } = await commerceStore();
    const { campaignId, offerIds } = await openCampaign(storeId, owner, [{ list: 100000, pre: 70000 }]);
    const client = await user();
    const order = await createStoreOrder({ campaignId, items: [{ offerId: offerIds[0], quantity: 1 }] }, client, prisma);
    await prisma.user.delete({ where: { id: client } });
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id }, select: { userId: true, customerEmailSnapshot: true, status: true } });
    expect(after?.userId).toBeNull();
    expect(after?.status).toBe("RESERVED");
    expect(after?.customerEmailSnapshot).toContain("@ro.dev"); // snapshot mínimo preserva identidad histórica
  });

  it("Merge/reparent de Work no invalida las líneas de la orden", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const { volumeId, editionId } = await volume(2);
    const offer = await addPreorderOffer({ campaignId: c.id, volumeId, listPriceCents: 100000, preorderPriceCents: 70000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: offer.id, quantity: 1 }] }, await user(), prisma);
    const survivor = await prisma.work.create({ data: { title: uniq(), normTitle: uniq(), type: "MANGA" }, select: { id: true } });
    await prisma.publisherEdition.update({ where: { id: editionId }, data: { workId: survivor.id } });
    const line = await prisma.storeOrderLine.findFirst({ where: { orderId: order.id }, include: { volume: { include: { edition: { select: { workId: true } } } } } });
    expect(line?.volumeId).toBe(volumeId); // la línea sigue apuntando al mismo Volume
    expect(line?.volume?.edition.workId).toBe(survivor.id); // resuelve el Work sobreviviente
  });
});
