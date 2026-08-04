/**
 * Integración de Collection — proyección de eventos PICKED_UP (Slice 8, ADR-010) contra Postgres REAL
 * desechable (skip sin `IDENTITY_TEST_DATABASE_URL`). Ejercita `projectPickupEvent` (clasificación + apply) y
 * las lecturas de pendientes/auditoría (doble anti-join, orden determinista, batch). NO toca cron ni post-commit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder } from "@/lib/retail/orders";
import {
  acquisitionKeyFor, projectPickupEvent, findPendingPickups, findCorruptPickups, findTerminalPickups,
  projectPickupByOperationKeys, findUnresolvedCatalogPickups, countUnresolvedCatalogPickups,
  type PickupEvent,
} from "@/lib/collection-context/projection";
import { PROJECTION_RESULT } from "@/lib/domain/collection/result";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Collection projection (Slice 8, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `cp-${Date.now()}-${seq++}`;

  const mkUser = async () => (await prisma.user.create({ data: { email: `${uniq()}@cp.dev`, name: "P" }, select: { id: true } })).id;
  async function mkVolume() {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number: 1 }, select: { id: true } })).id;
  }
  const ev = (over: Partial<PickupEvent> & { ownerUserIdSnapshot: string | null; volumeId: number | null }): PickupEvent => ({
    eventId: 1, operationKey: uniq(), quantity: 2, createdAt: new Date("2026-08-01T10:00:00Z"), ...over,
  });
  /** Cadena mínima Retail → una StoreOrderLine real (para el join de pendientes). Sin arribo/pickup. */
  async function makeLine() {
    const owner = await mkUser();
    const storeId = (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    const campaign = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const volumeId = await mkVolume();
    const offer = await addPreorderOffer({ campaignId: campaign.id, mode: "linked", volumeId, listPriceCents: 100000, preorderPriceCents: 50000 }, owner, prisma);
    await publishPreorderCampaign(campaign.id, owner, prisma);
    const client = await mkUser();
    const order = await createStoreOrder({ campaignId: campaign.id, items: [{ offerId: offer.id, quantity: 5 }] }, client, prisma);
    return { lineId: order.lines[0].id, ownerId: client, volumeId };
  }
  /** Cadena Retail con oferta MANUAL → una StoreOrderLine con volumeId NULL (F3). */
  async function makeManualLine(title = "Lanzamiento sin catalogar") {
    const owner = await mkUser();
    const storeId = (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    const campaign = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const offer = await addPreorderOffer({ campaignId: campaign.id, mode: "manual", descriptor: { title, volumeNumber: 3, publisher: "Panini" }, listPriceCents: 100000, preorderPriceCents: 50000 }, owner, prisma);
    await publishPreorderCampaign(campaign.id, owner, prisma);
    const client = await mkUser();
    const order = await createStoreOrder({ campaignId: campaign.id, items: [{ offerId: offer.id, quantity: 5 }] }, client, prisma);
    return { lineId: order.lines[0].id, ownerId: client, offerId: offer.id, campaignId: campaign.id, orderId: order.id, publicCode: order.publicCode };
  }
  /** Inserta directamente un evento PICKED_UP con snapshot controlado (bypass de contadores: sólo importa el ledger). */
  const mkPicked = (lineId: number, snapshot: string | null) =>
    prisma.storeOrderLineEvent.create({
      data: { orderLineId: lineId, type: "PICKED_UP", quantity: 2, actorUserId: null, operationKey: uniq(), ownerUserIdSnapshot: snapshot },
      select: { id: true, operationKey: true },
    });

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
    await prisma.user.deleteMany({ where: { email: { contains: "@cp.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- acquisitionKeyFor (helper único, determinista) -----------------------------------------------------
  it("acquisitionKeyFor: derivación determinista y estable", () => {
    expect(acquisitionKeyFor("abc")).toBe("retail-pickup:abc");
    expect(acquisitionKeyFor("abc")).toBe(acquisitionKeyFor("abc"));
    expect(acquisitionKeyFor("a")).not.toBe(acquisitionKeyFor("b"));
  });

  // --- projectPickupEvent ---------------------------------------------------------------------------------
  it("evento válido → APPLIED y crea la Acquisition", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const e = ev({ ownerUserIdSnapshot: userId, volumeId, quantity: 3 });
    expect(await projectPickupEvent(prisma, e)).toBe(PROJECTION_RESULT.APPLIED);
    expect(await prisma.acquisition.count({ where: { acquisitionKey: acquisitionKeyFor(e.operationKey) } })).toBe(1);
  });

  it("retry del mismo evento → ALREADY_APPLIED", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const e = ev({ ownerUserIdSnapshot: userId, volumeId });
    expect(await projectPickupEvent(prisma, e)).toBe(PROJECTION_RESULT.APPLIED);
    expect(await projectPickupEvent(prisma, e)).toBe(PROJECTION_RESULT.ALREADY_APPLIED);
  });

  it("snapshot nulo → CORRUPT_SOURCE (no aplica)", async () => {
    const e = ev({ ownerUserIdSnapshot: null, volumeId: 1 });
    expect(await projectPickupEvent(prisma, e)).toBe(PROJECTION_RESULT.CORRUPT_SOURCE);
    expect(await prisma.acquisition.count({ where: { acquisitionKey: acquisitionKeyFor(e.operationKey) } })).toBe(0);
  });

  it("snapshot presente + usuario eliminado antes de proyectar → TERMINALLY_NOT_APPLICABLE", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    await prisma.user.delete({ where: { id: userId } });
    const e = ev({ ownerUserIdSnapshot: userId, volumeId });
    expect(await projectPickupEvent(prisma, e)).toBe(PROJECTION_RESULT.TERMINALLY_NOT_APPLICABLE);
    expect(await prisma.acquisition.count({ where: { acquisitionKey: acquisitionKeyFor(e.operationKey) } })).toBe(0);
  });

  it("occurredAt preserva exactamente createdAt del evento; channel = RETAIL_PICKUP", async () => {
    const userId = await mkUser(); const volumeId = await mkVolume();
    const createdAt = new Date("2026-07-15T08:30:45.123Z");
    const e = ev({ ownerUserIdSnapshot: userId, volumeId, createdAt });
    expect(await projectPickupEvent(prisma, e)).toBe(PROJECTION_RESULT.APPLIED);
    const acq = await prisma.acquisition.findUnique({ where: { acquisitionKey: acquisitionKeyFor(e.operationKey) }, select: { occurredAt: true, channel: true } });
    expect(acq?.occurredAt.getTime()).toBe(createdAt.getTime());
    expect(acq?.channel).toBe("RETAIL_PICKUP");
  });

  // --- findPendingPickups (doble anti-join, orden, batch) -------------------------------------------------
  it("pendientes: excluye los ya aplicados (auto-avance)", async () => {
    const { lineId, ownerId } = await makeLine();
    const p = await mkPicked(lineId, ownerId);
    const before = await findPendingPickups(prisma, 100);
    const cand = before.find((x) => x.eventId === p.id);
    expect(cand).toBeTruthy();
    expect(await projectPickupEvent(prisma, cand!)).toBe(PROJECTION_RESULT.APPLIED); // usa el candidato tal cual lo lee el sweep
    const after = await findPendingPickups(prisma, 100);
    expect(after.map((x) => x.eventId)).not.toContain(p.id);
  });

  it("pendientes: excluye eventos con usuario inexistente", async () => {
    const { lineId, ownerId } = await makeLine();
    const valid = await mkPicked(lineId, ownerId);
    const ghost = await mkPicked(lineId, "ghost-user-that-does-not-exist");
    const ids = (await findPendingPickups(prisma, 100)).map((x) => x.eventId);
    expect(ids).toContain(valid.id);
    expect(ids).not.toContain(ghost.id);
  });

  it("pendientes: excluye eventos con snapshot nulo", async () => {
    const { lineId, ownerId } = await makeLine();
    const valid = await mkPicked(lineId, ownerId);
    const nul = await mkPicked(lineId, null);
    const ids = (await findPendingPickups(prisma, 100)).map((x) => x.eventId);
    expect(ids).toContain(valid.id);
    expect(ids).not.toContain(nul.id);
  });

  it("pendientes: orden determinista por event.id y límite de batch", async () => {
    const { lineId, ownerId } = await makeLine();
    const a = await mkPicked(lineId, ownerId);
    const b = await mkPicked(lineId, ownerId);
    const c = await mkPicked(lineId, ownerId);
    const page = await findPendingPickups(prisma, 2);
    expect(page.map((x) => x.eventId)).toEqual([a.id, b.id]); // los dos menores por id, asc
    expect(page.map((x) => x.eventId)).not.toContain(c.id); // el resto, próxima página
  });

  // --- auditoría separada de corruptos y terminales ------------------------------------------------------
  it("auditoría: corruptos y terminales se consultan por separado, disjuntos de pendientes", async () => {
    const { lineId, ownerId } = await makeLine();
    const nul = await mkPicked(lineId, null); // corrupto
    const ghostUser = await mkUser();
    const term = await mkPicked(lineId, ghostUser);
    await prisma.user.delete({ where: { id: ghostUser } }); // destino desaparece → terminal
    const valid = await mkPicked(lineId, ownerId);

    expect((await findCorruptPickups(prisma, 100)).map((x) => x.eventId)).toEqual([nul.id]);
    expect((await findTerminalPickups(prisma, 100)).map((x) => x.eventId)).toEqual([term.id]);
    expect((await findPendingPickups(prisma, 100)).map((x) => x.eventId)).toEqual([valid.id]);
  });

  // --- F3: líneas sin Volume (oferta manual) → pendiente de resolución de catálogo -------------------------
  it("projectPickupEvent con volumeId null → PENDING_CATALOG_RESOLUTION y NO escribe Acquisition ni OwnershipPosition", async () => {
    const owner = await mkUser();
    const r = await projectPickupEvent(prisma, ev({ ownerUserIdSnapshot: owner, volumeId: null }));
    expect(r).toBe(PROJECTION_RESULT.PENDING_CATALOG_RESOLUTION);
    expect(await prisma.acquisition.count()).toBe(0);
    expect(await prisma.ownershipPosition.count()).toBe(0);
  });

  it("findPendingPickups EXCLUYE en SQL las líneas con volumeId null (solo devuelve la vinculada)", async () => {
    const linked = await makeLine();
    const manual = await makeManualLine();
    const evLinked = await mkPicked(linked.lineId, linked.ownerId);
    await mkPicked(manual.lineId, manual.ownerId); // manual: line.volumeId null → excluido
    expect((await findPendingPickups(prisma, 100)).map((x) => x.eventId)).toEqual([evLinked.id]);
  });

  it("proyección inmediata (por operationKeys) contabiliza el caso nulo como pendingResolution", async () => {
    const manual = await makeManualLine();
    const picked = await mkPicked(manual.lineId, manual.ownerId);
    const tally = await projectPickupByOperationKeys([picked.operationKey], prisma);
    expect(tally.pendingResolution).toBe(1);
    expect(tally.applied).toBe(0);
    expect(await prisma.acquisition.count()).toBe(0);
  });

  it("observabilidad read-only: cuenta e identifica el backlog (campaña/pedido/línea/oferta + snapshot + fecha)", async () => {
    const linked = await makeLine();
    await mkPicked(linked.lineId, linked.ownerId); // vinculado: NO entra al backlog
    const manual = await makeManualLine("Kagurabachi");
    const picked = await mkPicked(manual.lineId, manual.ownerId);

    expect(await countUnresolvedCatalogPickups(prisma)).toBe(1);
    const rows = await findUnresolvedCatalogPickups(prisma, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: picked.id, orderLineId: manual.lineId, offerId: manual.offerId, orderId: manual.orderId,
      publicCode: manual.publicCode, campaignId: manual.campaignId,
      titleSnapshot: "Kagurabachi", volumeNumberSnapshot: 3, publisherSnapshot: "Panini",
    });
    expect(rows[0].pickedUpAt).toBeInstanceOf(Date);
  });

  it("el MISMO evento durable proyecta al resolverse (futuro), sin cambiar el snapshot histórico", async () => {
    const manual = await makeManualLine("Serie X");
    const picked = await mkPicked(manual.lineId, manual.ownerId);
    const before = await prisma.storeOrderLine.findUnique({ where: { id: manual.lineId }, select: { titleSnapshot: true, volumeNumberSnapshot: true, publisherSnapshot: true } });

    // 1) hoy: sin Volume → pendiente
    expect(await projectPickupEvent(prisma, ev({ ownerUserIdSnapshot: manual.ownerId, volumeId: null, operationKey: picked.operationKey }))).toBe(PROJECTION_RESULT.PENDING_CATALOG_RESOLUTION);

    // 2) futuro: se resuelve la línea contra un Volume real (aquí directo; F3 NO agrega el mecanismo de resolución)
    const resolvedVolume = await mkVolume();
    await prisma.storeOrderLine.update({ where: { id: manual.lineId }, data: { volumeId: resolvedVolume } });

    // 3) el MISMO evento (misma operationKey) ahora aplica
    expect(await projectPickupEvent(prisma, ev({ ownerUserIdSnapshot: manual.ownerId, volumeId: resolvedVolume, operationKey: picked.operationKey }))).toBe(PROJECTION_RESULT.APPLIED);
    expect(await prisma.acquisition.count({ where: { userId: manual.ownerId, volumeId: resolvedVolume } })).toBe(1);

    // el snapshot histórico de la línea NO cambió por resolver la identidad
    const after = await prisma.storeOrderLine.findUnique({ where: { id: manual.lineId }, select: { titleSnapshot: true, volumeNumberSnapshot: true, publisherSnapshot: true } });
    expect(after).toMatchObject({ titleSnapshot: before!.titleSnapshot, volumeNumberSnapshot: before!.volumeNumberSnapshot, publisherSnapshot: before!.publisherSnapshot });
  });
});
