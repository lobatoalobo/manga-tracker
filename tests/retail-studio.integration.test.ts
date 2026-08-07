/**
 * Integración de Retail — flujo del ESTUDIO SaaS contra Postgres REAL desechable (harness efímero; skip sin
 * `IDENTITY_TEST_DATABASE_URL`). Ejercita el camino real de servicios que usan las actions del estudio: crear
 * borrador → agregar oferta manual (reimpresión + descuento) y de catálogo → editar → reordenar → publicar, y
 * verifica el mapeo de `loadStudioState` (incluye los campos nuevos isReprint/publisherDiscountPct).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer, updatePreorderOffer } from "@/lib/retail/offers";
import { loadStudioState } from "@/lib/retail/studio";
import { RetailError } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Estudio SaaS (backend del flujo, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `st-${Date.now()}-${seq++}`;
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@st.dev`, name: `N-${seq}` }, select: { id: true } })).id;
  async function commerceStore() {
    const owner = await user();
    const storeId = (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    return { storeId, owner };
  }
  async function volume(number: number) {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea Argentina", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number, isbn: `978-${t}` }, select: { id: true } })).id;
  }

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.preorderOffer.deleteMany({});
    await prisma.preorderCampaign.deleteMany({});
    await prisma.storeMember.deleteMany({});
    await prisma.storeCommerceProfile.deleteMany({});
    await prisma.volume.deleteMany({});
    await prisma.publisherEdition.deleteMany({});
    await prisma.work.deleteMany({});
    await prisma.store.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@st.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("crea borrador → agrega manual (reimpresión+desc) y catálogo → edita → reordena → publica", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: "Estudio test", closesAt: inDays(3) }, owner, prisma);

    const manual = await addPreorderOffer(
      { campaignId: c.id, mode: "manual", descriptor: { title: "CALL OF THE NIGHT", volumeNumber: 1, publisher: "IVREA", isbn: null }, listPriceCents: 1_100_000, preorderPriceCents: 1_100_000, isReprint: true, publisherDiscountPct: 10 },
      owner, prisma,
    );
    const volumeId = await volume(5);
    const linked = await addPreorderOffer(
      { campaignId: c.id, mode: "linked", volumeId, listPriceCents: 1_200_000, preorderPriceCents: 1_100_000, isReprint: false, publisherDiscountPct: null },
      owner, prisma,
    );

    // editar precio + marcar reimpresión; reordenar (linked primero)
    await updatePreorderOffer(linked.id, { preorderPriceCents: 1_000_000, isReprint: true }, owner, prisma);
    await updatePreorderOffer(linked.id, { sortOrder: 0 }, owner, prisma);
    await updatePreorderOffer(manual.id, { sortOrder: 1 }, owner, prisma);

    const state = await loadStudioState(c.id, owner);
    expect(state.status).toBe("DRAFT");
    expect(state.offers).toHaveLength(2);
    expect(state.offers[0].id).toBe(linked.id); // sortOrder 0
    expect(state.offers[0].preorderPriceCents).toBe(1_000_000);
    expect(state.offers[0].isReprint).toBe(true);
    expect(state.offers[0].volumeId).toBe(volumeId);

    const m = state.offers.find((o) => o.id === manual.id)!;
    expect(m).toMatchObject({ isReprint: true, publisherDiscountPct: 10, volumeId: null, title: "CALL OF THE NIGHT", volumeNumber: 1 });

    await publishPreorderCampaign(c.id, owner, prisma);
    expect((await loadStudioState(c.id, owner)).status).toBe("PUBLISHED");
  });

  it("loadStudioState con expectedStoreId de otra tienda → CAMPAIGN_NOT_FOUND", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: "T" }, owner, prisma);
    await expect(loadStudioState(c.id, owner, storeId + 99_999)).rejects.toBeInstanceOf(RetailError);
  });
});
