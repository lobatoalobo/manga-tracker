/**
 * Integración de Retail — loader de la Home de Preventas (`loadPreordersDashboard`) contra Postgres REAL
 * desechable (harness efímero; skip sin `IDENTITY_TEST_DATABASE_URL`). Verifica el cableado de agregación
 * (SQL de contadores, groupBy de órdenes/ofertas, publishers), la etapa derivada por campaña y el
 * filtro/orden/paginación en memoria. La derivación pura ya está cubierta por el unit test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign, closePreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder } from "@/lib/retail/orders";
import { loadPreordersDashboard } from "@/lib/retail/preorders-dashboard";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Home de Preventas (loader, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  const NOW = new Date();
  const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
  let seq = 0;
  const uniq = () => `pd-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@pd.dev`, name: `N-${seq}` }, select: { id: true } })).id;

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
    const v = await prisma.volume.create({ data: { editionId: e.id, number, isbn: `978-${t}` }, select: { id: true } });
    return v.id;
  }
  async function offer(campaignId: number, owner: string, n: number, list: number, pre: number) {
    const volumeId = await volume(n);
    return (await addPreorderOffer({ campaignId, mode: "linked", volumeId, listPriceCents: list, preorderPriceCents: pre }, owner, prisma)).id;
  }
  /** Campaña PUBLISHED abierta con una fecha de cierre dada. */
  async function publishedCampaign(storeId: number, owner: string, title: string, closesAt: Date) {
    const c = await createPreorderCampaign({ storeId, title, opensAt: inDays(-1), closesAt }, owner, prisma);
    return c.id;
  }

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
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
    await prisma.user.deleteMany({ where: { email: { contains: "@pd.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("agrega KPIs, filas, etapas y montos reales de una tienda", async () => {
    const { storeId, owner } = await commerceStore();
    const c1 = await user(), c2 = await user(), c3 = await user(), c4 = await user();

    // A: DRAFT (preparando)
    await createPreorderCampaign({ storeId, title: "Borrador A" }, owner, prisma);

    // B: PUBLISHED abierta (cierre lejano), 2 ofertas, 2 órdenes
    const b = await publishedCampaign(storeId, owner, "Novedades B", inDays(5));
    const b1 = await offer(b, owner, 1, 10000, 9000);
    const b2 = await offer(b, owner, 2, 12000, 11000);
    await publishPreorderCampaign(b, owner, prisma);
    await createStoreOrder({ campaignId: b, items: [{ offerId: b1, quantity: 1 }, { offerId: b2, quantity: 1 }] }, c1, prisma, NOW); // 20000
    await createStoreOrder({ campaignId: b, items: [{ offerId: b1, quantity: 2 }] }, c2, prisma, NOW); // 18000

    // C: PUBLISHED por cerrar (cierre en 12h), 1 oferta, 1 orden
    const c = await publishedCampaign(storeId, owner, "Cierra pronto C", new Date(NOW.getTime() + 12 * 3_600_000));
    const c1o = await offer(c, owner, 1, 5000, 4500);
    await publishPreorderCampaign(c, owner, prisma);
    await createStoreOrder({ campaignId: c, items: [{ offerId: c1o, quantity: 1 }] }, c3, prisma, NOW); // 4500

    // D: CLOSED sin cumplir (pedido_distribuidor), 1 oferta, 1 orden
    const d = await publishedCampaign(storeId, owner, "Cerrada D", inDays(2));
    const d1 = await offer(d, owner, 1, 6000, 5500);
    await publishPreorderCampaign(d, owner, prisma);
    await createStoreOrder({ campaignId: d, items: [{ offerId: d1, quantity: 1 }] }, c4, prisma, NOW); // 5500
    await closePreorderCampaign(d, owner, prisma);

    const dash = await loadPreordersDashboard(storeId, {}, prisma, NOW);

    // KPIs
    expect(dash.kpis.activas).toBe(1);        // B
    expect(dash.kpis.porCerrar).toBe(1);      // C
    expect(dash.kpis.esperandoLlegada).toBe(0);
    expect(dash.kpis.entregando).toBe(0);
    expect(dash.kpis.reservadoMesCents).toBe(20000 + 18000 + 4500 + 5500); // 48000

    // Filas
    expect(dash.total).toBe(4);
    const byTitle = new Map(dash.rows.map((r) => [r.title, r]));

    const rowB = byTitle.get("Novedades B")!;
    expect(rowB.stage).toBe("abierta");
    expect(rowB.titulos).toBe(2);
    expect(rowB.reservas).toBe(2);
    expect(rowB.reservadoCents).toBe(38000);
    expect(rowB.cta).toBe("estudio");
    expect(rowB.covers).toBe(2);

    expect(byTitle.get("Cierra pronto C")!.stage).toBe("por_cerrar");
    expect(byTitle.get("Borrador A")!.stage).toBe("preparando");

    const rowD = byTitle.get("Cerrada D")!;
    expect(rowD.stage).toBe("pedido_distribuidor");
    expect(rowD.reservas).toBe(1);
    expect(rowD.reservadoCents).toBe(5500);
  });

  it("filtra por texto y por etapa, y pagina", async () => {
    const { storeId, owner } = await commerceStore();

    const a = await publishedCampaign(storeId, owner, "Alfa abierta", inDays(5));
    await offer(a, owner, 1, 1000, 900);
    await publishPreorderCampaign(a, owner, prisma);

    const b = await publishedCampaign(storeId, owner, "Beta por cerrar", new Date(Date.now() + 6 * 3_600_000));
    await offer(b, owner, 1, 1000, 900);
    await publishPreorderCampaign(b, owner, prisma);

    const all = await loadPreordersDashboard(storeId, {}, prisma, NOW);
    expect(all.total).toBe(2);

    const byText = await loadPreordersDashboard(storeId, { q: "alfa" }, prisma, NOW);
    expect(byText.total).toBe(1);
    expect(byText.rows[0].title).toBe("Alfa abierta");

    const byStage = await loadPreordersDashboard(storeId, { stage: "abierta" }, prisma, NOW);
    expect(byStage.total).toBe(1);
    expect(byStage.rows[0].title).toBe("Alfa abierta");

    const page2 = await loadPreordersDashboard(storeId, { page: 2 }, prisma, NOW);
    expect(page2.total).toBe(2);
    expect(page2.rows).toHaveLength(0); // pageSize 8 → segunda página vacía
    expect(page2.page).toBe(2);
  });
});
