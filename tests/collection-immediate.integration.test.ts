/**
 * Integración de Collection — proyección INMEDIATA post-commit (Slice 8, Paso 6) contra Postgres REAL
 * desechable (skip sin `IDENTITY_TEST_DATABASE_URL`). Ejercita la orquestación que la server action de pickup
 * invoca DESPUÉS del commit de Retail: procesa sólo los eventos de esa acción, es idempotente, aísla los fallos
 * de Collection del éxito de Retail y clasifica anomalías/terminales/reintentos. NO toca cron ni advisory lock.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder } from "@/lib/retail/orders";
import { markOrderLineArrived } from "@/lib/retail/fulfillment";
import { prepareOrderLine, pickupOrderLine, prepareOrderLines, pickupOrderLines, handoffBatchItemKey } from "@/lib/retail/handoff";
import { projectPickupImmediate, findPendingPickups, acquisitionKeyFor } from "@/lib/collection-context/projection";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Collection proyección inmediata (Slice 8, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `ci-${Date.now()}-${seq++}`;
  const key = () => `ik-${Date.now()}-${seq++}`;

  const mkUser = async () => (await prisma.user.create({ data: { email: `${uniq()}@ci.dev`, name: "I" }, select: { id: true } })).id;
  async function mkVolume(number: number) {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number }, select: { id: true } })).id;
  }
  /** Orden con líneas `{qty, arrive}` (marca llegadas). Devuelve dueño, staff y líneas con su volumen. */
  async function arrivedOrder(specs: Array<{ qty: number; arrive: number }>) {
    const owner = await mkUser();
    const storeId = (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    const campaign = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const offers: Array<{ offerId: number; volumeId: number }> = [];
    for (let i = 0; i < specs.length; i++) {
      const volumeId = await mkVolume(i + 1);
      const o = await addPreorderOffer({ campaignId: campaign.id, volumeId, listPriceCents: 100000, preorderPriceCents: 50000 }, owner, prisma);
      offers.push({ offerId: o.id, volumeId });
    }
    await publishPreorderCampaign(campaign.id, owner, prisma);
    const client = await mkUser();
    const order = await createStoreOrder({ campaignId: campaign.id, items: specs.map((s, i) => ({ offerId: offers[i].offerId, quantity: s.qty })) }, client, prisma);
    for (let i = 0; i < specs.length; i++) if (specs[i].arrive > 0) await markOrderLineArrived(order.lines[i].id, specs[i].arrive, owner, key(), prisma);
    return { orderId: order.id, client, owner, lines: order.lines.map((l, i) => ({ lineId: l.id, volumeId: offers[i].volumeId })) };
  }
  const positionOf = (userId: string, volumeId: number) =>
    prisma.ownershipPosition.findUnique({ where: { userId_volumeId: { userId, volumeId } }, select: { quantity: true } });

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.acquisition.deleteMany({});
    await prisma.ownershipPosition.deleteMany({});
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
    await prisma.user.deleteMany({ where: { email: { contains: "@ci.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("pickup individual: el commit de Retail NO escribe Collection; la proyección post-commit sí (APPLIED)", async () => {
    const { client, owner, lines } = await arrivedOrder([{ qty: 2, arrive: 2 }]);
    const { lineId, volumeId } = lines[0];
    await prepareOrderLine(lineId, 2, owner, key(), prisma);
    const opKey = key();
    await pickupOrderLine(lineId, 2, owner, opKey, prisma);
    // Retail committeó; su transacción NO tocó Collection (sin escritura cross-context en la tx de Retail).
    expect(await prisma.acquisition.count()).toBe(0);
    expect(await prisma.ownershipPosition.count()).toBe(0);
    // Proyección inmediata post-commit sobre el evento ya committeado.
    const tally = await projectPickupImmediate([opKey], prisma);
    expect(tally.applied).toBe(1);
    expect(await prisma.acquisition.count({ where: { acquisitionKey: acquisitionKeyFor(opKey) } })).toBe(1);
    expect(await positionOf(client, volumeId)).toEqual({ quantity: 2 });
  });

  it("pickup batch: proyecta todas las líneas creadas (claves exactas reconstruidas)", async () => {
    const { orderId, owner, client, lines } = await arrivedOrder([{ qty: 1, arrive: 1 }, { qty: 2, arrive: 2 }]);
    const items = lines.map((l, i) => ({ orderLineId: l.lineId, quantity: i === 0 ? 1 : 2 }));
    const bk = key();
    await prepareOrderLines(orderId, items, owner, key(), prisma);
    await pickupOrderLines(orderId, items, owner, bk, prisma);
    const keys = items.map((it) => handoffBatchItemKey(bk, "pickup", it.orderLineId));
    const tally = await projectPickupImmediate(keys, prisma);
    expect(tally.applied).toBe(2);
    expect(await positionOf(client, lines[0].volumeId)).toEqual({ quantity: 1 });
    expect(await positionOf(client, lines[1].volumeId)).toEqual({ quantity: 2 });
  });

  it("retry del mismo pickup no duplica (ALREADY_APPLIED)", async () => {
    const { owner, client, lines } = await arrivedOrder([{ qty: 2, arrive: 2 }]);
    const { lineId, volumeId } = lines[0];
    await prepareOrderLine(lineId, 2, owner, key(), prisma);
    const opKey = key();
    await pickupOrderLine(lineId, 2, owner, opKey, prisma);
    expect((await projectPickupImmediate([opKey], prisma)).applied).toBe(1);
    const second = await projectPickupImmediate([opKey], prisma);
    expect(second).toMatchObject({ applied: 0, alreadyApplied: 1 });
    expect(await positionOf(client, volumeId)).toEqual({ quantity: 2 });
    expect(await prisma.acquisition.count({ where: { acquisitionKey: acquisitionKeyFor(opKey) } })).toBe(1);
  });

  it("fallo de Collection (RETRYABLE) no altera el pickup de Retail; queda pendiente para el barrido", async () => {
    const { owner, client, lines } = await arrivedOrder([{ qty: 1, arrive: 1 }]);
    const { lineId, volumeId } = lines[0];
    await prepareOrderLine(lineId, 1, owner, key(), prisma);
    const opKey = key();
    await pickupOrderLine(lineId, 1, owner, opKey, prisma);
    await prisma.ownershipPosition.create({ data: { userId: client, volumeId, quantity: 2147483647 } }); // el incremento desbordará
    const tally = await projectPickupImmediate([opKey], prisma); // NO debe lanzar
    expect(tally.retryable).toBe(1);
    // Retail intacto: evento y contador de retiro persisten.
    expect(await prisma.storeOrderLineEvent.findUnique({ where: { operationKey: opKey }, select: { type: true, ownerUserIdSnapshot: true } }))
      .toMatchObject({ type: "PICKED_UP", ownerUserIdSnapshot: client });
    expect(await prisma.storeOrderLine.findUnique({ where: { id: lineId }, select: { pickedUpQuantity: true } })).toEqual({ pickedUpQuantity: 1 });
    // Collection: la Acquisition no se creó (rollback) → sigue pendiente.
    expect(await prisma.acquisition.count({ where: { acquisitionKey: acquisitionKeyFor(opKey) } })).toBe(0);
    expect((await findPendingPickups(prisma, 100)).map((p) => p.operationKey)).toContain(opKey);
  });

  it("anomalías observables en el tally: CORRUPT_SOURCE (snapshot nulo) y CONFLICT (misma clave, otro payload)", async () => {
    const { owner, client, lines } = await arrivedOrder([{ qty: 3, arrive: 3 }]);
    const { lineId, volumeId } = lines[0];
    // CORRUPT: evento PICKED_UP con snapshot nulo (insertado directo).
    const corruptKey = key();
    await prisma.storeOrderLineEvent.create({ data: { orderLineId: lineId, type: "PICKED_UP", quantity: 1, actorUserId: null, operationKey: corruptKey, ownerUserIdSnapshot: null } });
    expect((await projectPickupImmediate([corruptKey], prisma)).corrupt).toBe(1);
    // CONFLICT: pickup real, pero la clave derivada ya tiene una Acquisition con OTRO payload.
    await prepareOrderLine(lineId, 2, owner, key(), prisma);
    const opKey = key();
    await pickupOrderLine(lineId, 2, owner, opKey, prisma);
    await prisma.acquisition.create({ data: { acquisitionKey: acquisitionKeyFor(opKey), userId: client, volumeId, quantity: 99, channel: "RETAIL_PICKUP", occurredAt: new Date("2020-01-01T00:00:00Z") } });
    expect((await projectPickupImmediate([opKey], prisma)).conflict).toBe(1);
  });
});
