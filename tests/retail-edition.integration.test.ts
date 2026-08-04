/**
 * Integración de Retail — P-03 · Estudio: ORDEN editorial (commit 3A). Base real desechable; skip sin
 * `IDENTITY_TEST_DATABASE_URL`. Ejercita `reorderPreorderOffers` y el "alta al final" de `addPreorderOffer`
 * con `actorUserId` explícito y cliente efímero inyectado.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer, reorderPreorderOffers } from "@/lib/retail/offers";
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
