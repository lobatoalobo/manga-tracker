/**
 * Integración de Retail — Ofertas de VÍNCULO DE CATÁLOGO OPCIONAL (slice F2), contra Postgres REAL desechable.
 * Verifica: creación de oferta MANUAL (sin Volume, snapshot autorado), VOLUME_NOT_FOUND condicional al modo
 * linked, orden desde oferta manual (línea con volumeId null y snapshots copiados EXCLUSIVAMENTE de la oferta),
 * y el ciclo comercial COMPLETO sobre una orden no vinculada (pago → cumplimiento → preparación → retiro). El
 * proyector de Collection NO se ejercita aquí (los servicios no lo invocan; eso es F3).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder, getCustomerOrder } from "@/lib/retail/orders";
import { getPublicCampaign } from "@/lib/retail/public";
import { registerPayment } from "@/lib/retail/payments";
import { markOrderLineOrdered, markOrderLineArrived } from "@/lib/retail/fulfillment";
import { prepareOrderLine, pickupOrderLine } from "@/lib/retail/handoff";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — ofertas con vínculo de catálogo opcional (F2, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `rov-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@rov.dev`, name: `N-${seq}` }, select: { id: true } })).id;
  async function commerceStore() {
    const owner = await user();
    const storeId = (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
    const p = await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    return { storeId, owner, slug: p.slug };
  }
  async function realVolume(number = 1) {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea Argentina", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number }, select: { id: true } })).id;
  }
  const retailCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; } };

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.storeOrderLineEvent.deleteMany({});
    await prisma.storePayment.deleteMany({});
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
    await prisma.user.deleteMany({ where: { email: { contains: "@rov.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- creación de oferta manual --------------------------------------------
  it("oferta MANUAL: volumeId null y snapshot autorado desde el descriptor", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const o = await addPreorderOffer(
      { campaignId: c.id, mode: "manual", descriptor: { title: "  Kagurabachi  ", volumeNumber: 1, publisher: " Ivrea ", isbn: "" }, listPriceCents: 100000, preorderPriceCents: 80000 },
      owner, prisma,
    );
    expect(o.volumeId).toBeNull();
    expect(o).toMatchObject({ titleSnapshot: "Kagurabachi", volumeNumberSnapshot: 1, publisherSnapshot: "Ivrea", isbnSnapshot: null, status: "ACTIVE" });
  });

  it("oferta MANUAL con título vacío → INVALID_TITLE (no crea nada)", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    expect(await retailCode(() => addPreorderOffer(
      { campaignId: c.id, mode: "manual", descriptor: { title: "   " }, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma,
    ))).toBe(RETAIL_ERROR.INVALID_TITLE);
    expect(await prisma.preorderOffer.count({ where: { campaignId: c.id } })).toBe(0);
  });

  it("VOLUME_NOT_FOUND SOLO en modo linked con volumeId inexistente (manual nunca lo toca)", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    expect(await retailCode(() => addPreorderOffer(
      { campaignId: c.id, mode: "linked", volumeId: 999999999, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma,
    ))).toBe(RETAIL_ERROR.VOLUME_NOT_FOUND);
    // manual no resuelve catálogo → nunca VOLUME_NOT_FOUND
    expect(await retailCode(() => addPreorderOffer(
      { campaignId: c.id, mode: "manual", descriptor: { title: "Debut" }, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma,
    ))).toBe("NO_THROW");
  });

  it("oferta linked y manual conviven en la misma campaña", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const linked = await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: await realVolume(1), listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma);
    const manual = await addPreorderOffer({ campaignId: c.id, mode: "manual", descriptor: { title: "No catalogado" }, listPriceCents: 2000, preorderPriceCents: 1800 }, owner, prisma);
    expect(linked.volumeId).not.toBeNull();
    expect(manual.volumeId).toBeNull();
    expect(await prisma.preorderOffer.count({ where: { campaignId: c.id } })).toBe(2);
  });

  it("degradación pública: la oferta manual se ve por getPublicCampaign (volumeId null, snapshot suficiente)", async () => {
    const { storeId, owner, slug } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    await addPreorderOffer({ campaignId: c.id, mode: "manual", descriptor: { title: "Próximo tomo", volumeNumber: 2, publisher: "Ovni" }, listPriceCents: 100000, preorderPriceCents: 75000 }, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    const pub = await getPublicCampaign(slug, c.id, new Date(), prisma);
    expect(pub?.offers).toHaveLength(1);
    expect(pub?.offers[0]).toMatchObject({ volumeId: null, title: "Próximo tomo", volumeNumber: 2, publisher: "Ovni", discountPercent: 25 });
  });

  // --- orden desde oferta manual --------------------------------------------
  it("orden desde oferta MANUAL: línea con volumeId null y snapshots copiados de la oferta (no del catálogo)", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const o = await addPreorderOffer(
      { campaignId: c.id, mode: "manual", descriptor: { title: "Lanzamiento X", volumeNumber: 7, publisher: "Panini" }, listPriceCents: 100000, preorderPriceCents: 90000 },
      owner, prisma,
    );
    await publishPreorderCampaign(c.id, owner, prisma);
    const client = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: o.id, quantity: 2 }] }, client, prisma);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].volumeId).toBeNull();
    expect(order.lines[0]).toMatchObject({ titleSnapshot: "Lanzamiento X", volumeNumberSnapshot: 7, publisherSnapshot: "Panini", lineTotalCents: 180000 });
    // El comprador ve la línea manual con su snapshot
    const view = await getCustomerOrder(order.publicCode, client, prisma);
    expect(view.lines[0].volumeId).toBeNull();
    expect(view.lines[0].titleSnapshot).toBe("Lanzamiento X");
  });

  // --- ciclo comercial completo sin Volume ----------------------------------
  it("ciclo comercial COMPLETO sobre orden no vinculada: pago → cumplimiento → preparación → retiro", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const o = await addPreorderOffer(
      { campaignId: c.id, mode: "manual", descriptor: { title: "Manga futuro" }, listPriceCents: 100000, preorderPriceCents: 100000 },
      owner, prisma,
    );
    await publishPreorderCampaign(c.id, owner, prisma);
    const client = await user();
    const order = await createStoreOrder({ campaignId: c.id, items: [{ offerId: o.id, quantity: 1 }] }, client, prisma);
    const lineId = order.lines[0].id;

    // pago total
    await registerPayment({ orderId: order.id, amountCents: 100000, method: "TRANSFER", paidAt: new Date() }, owner, `${uniq()}-pay`, prisma);
    // cumplimiento (pedido → llegada) y handoff (preparado → retirado)
    await markOrderLineOrdered(lineId, 1, owner, `${uniq()}-ord`, prisma);
    await markOrderLineArrived(lineId, 1, owner, `${uniq()}-arr`, prisma);
    await prepareOrderLine(lineId, 1, owner, `${uniq()}-prep`, prisma);
    await pickupOrderLine(lineId, 1, owner, `${uniq()}-pick`, prisma);

    const line = await prisma.storeOrderLine.findUnique({ where: { id: lineId }, select: { volumeId: true, arrivedQuantity: true, preparedQuantity: true, pickedUpQuantity: true } });
    expect(line).toMatchObject({ volumeId: null, arrivedQuantity: 1, preparedQuantity: 1, pickedUpQuantity: 1 });
    const paid = await prisma.storeOrder.findUnique({ where: { id: order.id }, select: { paymentStatus: true, paidCents: true } });
    expect(paid).toMatchObject({ paymentStatus: "PAID", paidCents: 100000 });
    // El hecho PICKED_UP quedó registrado (durable) con la línea sin volumeId → lo tolerará F3 (aquí no se proyecta).
    const picked = await prisma.storeOrderLineEvent.findFirst({ where: { orderLineId: lineId, type: "PICKED_UP" }, select: { ownerUserIdSnapshot: true } });
    expect(picked?.ownerUserIdSnapshot).toBe(client);
  });
});
