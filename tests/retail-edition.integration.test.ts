/**
 * Integración de Retail — P-03 · Estudio: ORDEN editorial (commit 3A). Base real desechable; skip sin
 * `IDENTITY_TEST_DATABASE_URL`. Ejercita `reorderPreorderOffers` y el "alta al final" de `addPreorderOffer`
 * con `actorUserId` explícito y cliente efímero inyectado.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign, setCampaignPrincipal } from "@/lib/retail/campaigns";
import {
  addPreorderOffer, reorderPreorderOffers, setOfferOnCover,
  hidePreorderOffer, cancelPreorderOffer, removeDraftPreorderOffer,
} from "@/lib/retail/offers";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Estudio / orden editorial (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `est-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@est.dev` }, select: { id: true } })).id;
  const store = async () => (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
  async function commerceStore(enabled = true) {
    const owner = await user();
    const storeId = await store();
    const p = await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled }, prisma);
    return { storeId, owner };
  }
  const retailCode = async (fn: () => Promise<unknown>) => {
    try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; }
  };
  // Oferta manual (no requiere Volume): título único + precios.
  const addManual = (campaignId: number, owner: string) =>
    addPreorderOffer(
      { campaignId, mode: "manual", descriptor: { title: uniq(), volumeNumber: 1, publisher: "Ivrea" }, listPriceCents: 10_000, preorderPriceCents: 8_000 },
      owner, prisma,
    );
  const sortOrders = async (campaignId: number) =>
    (await prisma.preorderOffer.findMany({ where: { campaignId }, orderBy: { id: "asc" }, select: { id: true, sortOrder: true } }));

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  afterEach(async () => {
    await prisma.preorderCampaign.updateMany({ data: { principalOfferId: null } });
    await prisma.preorderOffer.deleteMany({});
    await prisma.preorderCampaign.deleteMany({});
  });

  it("alta al final: cada oferta nueva recibe sortOrder = último + 1", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const a = await addManual(c.id, owner);
    const b = await addManual(c.id, owner);
    const d = await addManual(c.id, owner);
    const map = new Map((await sortOrders(c.id)).map((o) => [o.id, o.sortOrder]));
    expect(map.get(a.id)).toBe(0);
    expect(map.get(b.id)).toBe(1);
    expect(map.get(d.id)).toBe(2);
  });

  it("reordena a una permutación y reescribe sortOrder por índice", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const a = await addManual(c.id, owner);
    const b = await addManual(c.id, owner);
    const d = await addManual(c.id, owner);
    await reorderPreorderOffers(c.id, [d.id, a.id, b.id], owner, prisma);
    const map = new Map((await sortOrders(c.id)).map((o) => [o.id, o.sortOrder]));
    expect(map.get(d.id)).toBe(0);
    expect(map.get(a.id)).toBe(1);
    expect(map.get(b.id)).toBe(2);
  });

  it("idempotente: reordenar al mismo orden no cambia nada", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const a = await addManual(c.id, owner);
    const b = await addManual(c.id, owner);
    await reorderPreorderOffers(c.id, [a.id, b.id], owner, prisma);
    await reorderPreorderOffers(c.id, [a.id, b.id], owner, prisma);
    const map = new Map((await sortOrders(c.id)).map((o) => [o.id, o.sortOrder]));
    expect(map.get(a.id)).toBe(0);
    expect(map.get(b.id)).toBe(1);
  });

  it("rechaza un conjunto inválido (falta una oferta) → INVALID_REORDER_SET", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const a = await addManual(c.id, owner);
    await addManual(c.id, owner);
    expect(await retailCode(() => reorderPreorderOffers(c.id, [a.id], owner, prisma))).toBe(RETAIL_ERROR.INVALID_REORDER_SET);
  });

  it("solo en DRAFT: reordenar una campaña publicada → CAMPAIGN_NOT_EDITABLE", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const a = await addManual(c.id, owner);
    const b = await addManual(c.id, owner);
    await publishPreorderCampaign(c.id, owner, prisma);
    expect(await retailCode(() => reorderPreorderOffers(c.id, [b.id, a.id], owner, prisma))).toBe(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE);
  });
});

describe.skipIf(!URL)("integración — Estudio / portada y principal (base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `pp-${Date.now()}-${seq++}`;
  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@pp.dev` }, select: { id: true } })).id;
  const store = async () => (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
  async function commerceStore() {
    const owner = await user();
    const storeId = await store();
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    return { storeId, owner };
  }
  const retailCode = async (fn: () => Promise<unknown>) => {
    try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; }
  };
  const addManual = (campaignId: number, owner: string) =>
    addPreorderOffer(
      { campaignId, mode: "manual", descriptor: { title: uniq(), volumeNumber: 1, publisher: "Ivrea" }, listPriceCents: 10_000, preorderPriceCents: 8_000 },
      owner, prisma,
    );
  const draft = async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    return { owner, c };
  };
  const principalId = async (campaignId: number) =>
    (await prisma.preorderCampaign.findUnique({ where: { id: campaignId }, select: { principalOfferId: true } }))?.principalOfferId ?? null;
  const isOnCover = async (offerId: number) =>
    (await prisma.preorderOffer.findUnique({ where: { id: offerId }, select: { onCover: true } }))?.onCover ?? false;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  afterEach(async () => {
    await prisma.preorderCampaign.updateMany({ data: { principalOfferId: null } });
    await prisma.preorderOffer.deleteMany({});
    await prisma.preorderCampaign.deleteMany({});
  });

  it("sube y baja de portada (idempotente)", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    expect(await isOnCover(a.id)).toBe(false);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setOfferOnCover(a.id, true, owner, prisma); // idempotente
    expect(await isOnCover(a.id)).toBe(true);
    await setOfferOnCover(a.id, false, owner, prisma);
    expect(await isOnCover(a.id)).toBe(false);
  });

  it("elige una principal válida (ACTIVE + onCover, misma campaña)", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma); // idempotente
    expect(await principalId(c.id)).toBe(a.id);
  });

  it("rechaza oferta de OTRA campaña → OFFER_NOT_FOUND", async () => {
    const { owner, c } = await draft();
    const c2 = await createPreorderCampaign({ storeId: (await prisma.preorderCampaign.findUnique({ where: { id: c.id }, select: { storeId: true } }))!.storeId, title: uniq() }, owner, prisma);
    const other = await addManual(c2.id, owner);
    await setOfferOnCover(other.id, true, owner, prisma);
    expect(await retailCode(() => setCampaignPrincipal(c.id, other.id, owner, prisma))).toBe(RETAIL_ERROR.OFFER_NOT_FOUND);
  });

  it("rechaza oferta NO activa → OFFER_NOT_AVAILABLE", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await hidePreorderOffer(a.id, owner, prisma); // sigue onCover=true pero HIDDEN
    expect(await retailCode(() => setCampaignPrincipal(c.id, a.id, owner, prisma))).toBe(RETAIL_ERROR.OFFER_NOT_AVAILABLE);
  });

  it("rechaza oferta FUERA de portada → PRINCIPAL_NOT_ON_COVER", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner); // onCover=false por defecto
    expect(await retailCode(() => setCampaignPrincipal(c.id, a.id, owner, prisma))).toBe(RETAIL_ERROR.PRINCIPAL_NOT_ON_COVER);
  });

  it("bajar de portada a la principal limpia principalOfferId", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma);
    await setOfferOnCover(a.id, false, owner, prisma);
    expect(await principalId(c.id)).toBeNull();
  });

  it("ocultar la principal limpia principalOfferId", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma);
    await hidePreorderOffer(a.id, owner, prisma);
    expect(await principalId(c.id)).toBeNull();
  });

  it("cancelar la principal limpia principalOfferId", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma);
    await cancelPreorderOffer(a.id, owner, prisma);
    expect(await principalId(c.id)).toBeNull();
  });

  it("quitar la principal limpia principalOfferId vía FK SET NULL", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma);
    await removeDraftPreorderOffer(a.id, owner, prisma); // DELETE → FK ON DELETE SET NULL
    expect(await principalId(c.id)).toBeNull();
  });

  it("offerId=null limpia la principal", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await setCampaignPrincipal(c.id, a.id, owner, prisma);
    await setCampaignPrincipal(c.id, null, owner, prisma);
    expect(await principalId(c.id)).toBeNull();
  });

  it("solo DRAFT: portada/principal sobre una campaña publicada → CAMPAIGN_NOT_EDITABLE", async () => {
    const { owner, c } = await draft();
    const a = await addManual(c.id, owner);
    await setOfferOnCover(a.id, true, owner, prisma);
    await publishPreorderCampaign(c.id, owner, prisma);
    expect(await retailCode(() => setOfferOnCover(a.id, false, owner, prisma))).toBe(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE);
    expect(await retailCode(() => setCampaignPrincipal(c.id, a.id, owner, prisma))).toBe(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE);
  });
});
