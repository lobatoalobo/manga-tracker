/**
 * Integración de Retail — Preventas (Slice 2) contra Postgres REAL desechable (harness efímero; skip sin
 * `IDENTITY_TEST_DATABASE_URL`). Ejercita los SERVICIOS con `actorUserId` explícito (sin `auth()`) y el
 * cliente efímero inyectado: ciclo de vida de campaña, ofertas con Volume real, unicidad, publicación,
 * lectura pública, concurrencia, FK Restrict (Store/Volume) y aislamiento entre tiendas.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember } from "@/lib/storeCommerce";
import {
  createPreorderCampaign, publishPreorderCampaign, closePreorderCampaign, cancelPreorderCampaign, getStoreCampaign,
} from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { getPublicCampaign } from "@/lib/retail/public";
import { STORE_ROLE, StoreAuthError, STORE_AUTH_ERROR } from "@/lib/domain/store/authorize";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Preventas (Slice 2, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `rt-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@rt.dev` }, select: { id: true } })).id;
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
  const retailCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : `X:${(e as Error).message}`; } };
  const authCode = async (fn: () => Promise<unknown>) => { try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof StoreAuthError ? e.code : `X:${(e as Error).message}`; } };

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
    await prisma.user.deleteMany({ where: { email: { contains: "@rt.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("crear campaña (OWNER) → DRAFT con createdByUserId", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: "Semana 5" }, owner, prisma);
    expect(c).toMatchObject({ status: "DRAFT", title: "Semana 5", createdByUserId: owner });
  });

  it("agregar oferta con Volume real → snapshot resuelto del catálogo", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const vId = await volume(3);
    const o = await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000000, preorderPriceCents: 700000 }, owner, prisma);
    expect(o).toMatchObject({ status: "ACTIVE", volumeNumberSnapshot: 3, publisherSnapshot: "Ivrea Argentina", listPriceCents: 1000000, preorderPriceCents: 700000 });
    expect(o.titleSnapshot).toBeTruthy();
  });

  it("no duplicar el mismo Volume en una campaña → OFFER_ALREADY_EXISTS", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const vId = await volume();
    await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma);
    expect(await retailCode(() => addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma))).toBe(RETAIL_ERROR.OFFER_ALREADY_EXISTS);
  });

  it("publicar campaña válida (OWNER) → PUBLISHED con publishedAt", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: await volume(), listPriceCents: 1000, preorderPriceCents: 800 }, owner, prisma);
    const pub = await publishPreorderCampaign(c.id, owner, prisma);
    expect(pub?.status).toBe("PUBLISHED");
    expect(pub?.publishedAt).toBeTruthy();
  });

  it("rechazar publicación vacía → CAMPAIGN_HAS_NO_OFFERS", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    expect(await retailCode(() => publishPreorderCampaign(c.id, owner, prisma))).toBe(RETAIL_ERROR.CAMPAIGN_HAS_NO_OFFERS);
  });

  it("STAFF no puede publicar → FORBIDDEN_ROLE (política: publicar = OWNER)", async () => {
    const { storeId, owner, profileId } = await commerceStore();
    const staff = await user();
    await addMember(profileId, staff, STORE_ROLE.STAFF, prisma);
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: await volume(), listPriceCents: 1000, preorderPriceCents: 800 }, owner, prisma);
    expect(await authCode(() => publishPreorderCampaign(c.id, staff, prisma))).toBe(STORE_AUTH_ERROR.FORBIDDEN_ROLE);
  });

  it("lectura pública: publicada visible; borrador NO", async () => {
    const { storeId, owner, slug } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: "Pública" }, owner, prisma);
    await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: await volume(1), listPriceCents: 1200000, preorderPriceCents: 900000 }, owner, prisma);
    expect(await getPublicCampaign(slug, c.id, new Date(), prisma)).toBeNull(); // DRAFT no pública
    await publishPreorderCampaign(c.id, owner, prisma);
    const pub = await getPublicCampaign(slug, c.id, new Date(), prisma);
    expect(pub).toMatchObject({ title: "Pública", status: "PUBLISHED" });
    expect(pub?.offers).toHaveLength(1);
    expect(pub?.offers[0].discountPercent).toBe(25);
  });

  it("cerrar y cancelar", async () => {
    const { storeId, owner } = await commerceStore();
    const c1 = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    await addPreorderOffer({ campaignId: c1.id, mode: "linked", volumeId: await volume(), listPriceCents: 1000, preorderPriceCents: 800 }, owner, prisma);
    await publishPreorderCampaign(c1.id, owner, prisma);
    expect((await closePreorderCampaign(c1.id, owner, prisma))?.status).toBe("CLOSED");
    const c2 = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    expect((await cancelPreorderCampaign(c2.id, owner, prisma))?.status).toBe("CANCELLED");
  });

  it("concurrencia: dos altas del mismo Volume → una gana, otra OFFER_ALREADY_EXISTS", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const vId = await volume();
    const add = () => addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma);
    const [r1, r2] = await Promise.allSettled([add(), add()]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(await prisma.preorderOffer.count({ where: { campaignId: c.id } })).toBe(1);
  });

  it("concurrencia: doble publicación → idempotente (PUBLISHED, publishedAt seteado)", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: await volume(), listPriceCents: 1000, preorderPriceCents: 800 }, owner, prisma);
    const [r1, r2] = await Promise.allSettled([publishPreorderCampaign(c.id, owner, prisma), publishPreorderCampaign(c.id, owner, prisma)]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
    const after = await prisma.preorderCampaign.findUnique({ where: { id: c.id }, select: { status: true, publishedAt: true } });
    expect(after?.status).toBe("PUBLISHED");
    expect(after?.publishedAt).toBeTruthy();
  });

  it("FK Restrict: no se puede borrar una Store con campañas", async () => {
    const { storeId, owner } = await commerceStore();
    await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    await expect(prisma.store.delete({ where: { id: storeId } })).rejects.toBeTruthy();
  });

  it("FK Restrict (Volume modelado en Prisma): no se puede borrar un Volume con ofertas", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const vId = await volume();
    await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma);
    await expect(prisma.volume.delete({ where: { id: vId } })).rejects.toBeTruthy();
  });

  it("la oferta carga su Volume vía relación Prisma (include)", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const vId = await volume(7);
    const o = await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma);
    const loaded = await prisma.preorderOffer.findUnique({ where: { id: o.id }, include: { volume: { include: { edition: true } } } });
    expect(loaded?.volume?.id).toBe(vId);
    expect(loaded?.volume?.number).toBe(7);
    expect(loaded?.volume?.edition.publisher).toBe("Ivrea Argentina");
  });

  it("Merge/reparent de Work no invalida la oferta: el Volume no cambia; resuelve el Work sobreviviente", async () => {
    const { storeId, owner } = await commerceStore();
    const c = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const vId = await volume(2);
    const o = await addPreorderOffer({ campaignId: c.id, mode: "linked", volumeId: vId, listPriceCents: 1000, preorderPriceCents: 900 }, owner, prisma);
    // Simula la absorción: la edición del volumen se re-parenta a otro Work (Volume.id/editionId no cambian).
    const survivor = await prisma.work.create({ data: { title: uniq(), normTitle: uniq(), type: "MANGA" }, select: { id: true } });
    const before = await prisma.volume.findUnique({ where: { id: vId }, select: { editionId: true } });
    await prisma.publisherEdition.update({ where: { id: before!.editionId }, data: { workId: survivor.id } });
    const after = await prisma.preorderOffer.findUnique({ where: { id: o.id }, include: { volume: { include: { edition: { select: { workId: true } } } } } });
    expect(after?.volumeId).toBe(vId); // la oferta sigue apuntando al mismo Volume
    expect(after?.volume?.edition.workId).toBe(survivor.id); // resuelve el Work sobreviviente
  });

  it("aislamiento entre tiendas: un miembro de otra tienda no accede a la campaña → NOT_A_MEMBER", async () => {
    const a = await commerceStore();
    const b = await commerceStore();
    const c = await createPreorderCampaign({ storeId: a.storeId, title: uniq() }, a.owner, prisma);
    expect(await authCode(() => getStoreCampaign(c.id, b.owner, prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
    expect(await authCode(() => publishPreorderCampaign(c.id, b.owner, prisma))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });
});
