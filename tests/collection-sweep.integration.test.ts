/**
 * Integración de Collection — barrido durable + cron (Slice 8, Paso 7) contra Postgres REAL desechable (skip
 * sin `IDENTITY_TEST_DATABASE_URL`). Ejercita: auth del cron, advisory lock (afinidad de sesión) y su salida
 * limpia si ya corre otro, paginación multi-página, orden/batch, presupuesto de tiempo, aislamiento por evento,
 * recuperación en la 2da corrida, conjunto vacío, resumen/contadores y liberación del lock ante error.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce } from "@/lib/storeCommerce";
import { createPreorderCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { addPreorderOffer } from "@/lib/retail/offers";
import { createStoreOrder } from "@/lib/retail/orders";
import { findPendingPickups } from "@/lib/collection-context/projection";
import { sweepPickupProjections, SWEEP_LOCK_KEY } from "@/lib/collection-context/sweep";
import { GET } from "@/app/api/cron/collection-projection/route";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Collection barrido durable (Slice 8, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `cs-${Date.now()}-${seq++}`;

  const mkUser = async () => (await prisma.user.create({ data: { email: `${uniq()}@cs.dev`, name: "S" }, select: { id: true } })).id;
  async function mkVolume(number: number) {
    const t = uniq();
    const w = await prisma.work.create({ data: { title: t, normTitle: t, type: "MANGA" }, select: { id: true } });
    const e = await prisma.publisherEdition.create({ data: { workId: w.id, publisher: "Ivrea", slug: t, title: t, normTitle: t, volumes: 10, url: "" }, select: { id: true } });
    return (await prisma.volume.create({ data: { editionId: e.id, number }, select: { id: true } })).id;
  }
  /** Orden con `n` líneas reales (sin arribo). Devuelve el dueño (cliente) y las líneas con su volumen. */
  async function makeOrder(n: number) {
    const owner = await mkUser();
    const storeId = (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    const campaign = await createPreorderCampaign({ storeId, title: uniq() }, owner, prisma);
    const offers: Array<{ offerId: number; volumeId: number }> = [];
    for (let i = 0; i < n; i++) {
      const volumeId = await mkVolume(i + 1);
      const o = await addPreorderOffer({ campaignId: campaign.id, mode: "linked", volumeId, listPriceCents: 100000, preorderPriceCents: 50000 }, owner, prisma);
      offers.push({ offerId: o.id, volumeId });
    }
    await publishPreorderCampaign(campaign.id, owner, prisma);
    const client = await mkUser();
    const order = await createStoreOrder({ campaignId: campaign.id, items: offers.map((o) => ({ offerId: o.offerId, quantity: 5 })) }, client, prisma);
    return { client, lines: order.lines.map((l, i) => ({ lineId: l.id, volumeId: offers[i].volumeId })) };
  }
  const mkPicked = (lineId: number, snapshot: string | null) =>
    prisma.storeOrderLineEvent.create({
      data: { orderLineId: lineId, type: "PICKED_UP", quantity: 2, actorUserId: null, operationKey: uniq(), ownerUserIdSnapshot: snapshot },
      select: { id: true },
    });
  const withOne = (u: string) => (u.includes("?") ? `${u}&connection_limit=1` : `${u}?connection_limit=1`);

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
    await prisma.user.deleteMany({ where: { email: { contains: "@cs.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- Ruta / auth ----------------------------------------------------------------------------------------
  it("ruta: sin auth o con auth incorrecta → 401", async () => {
    const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = "sekret";
    try {
      expect((await GET(new Request("http://x/api/cron/collection-projection"))).status).toBe(401);
      expect((await GET(new Request("http://x/api/cron/collection-projection", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    } finally { process.env.CRON_SECRET = prev; }
  });

  it("ruta: auth correcta → ejecuta el sweep y responde el resumen", async () => {
    const prevSecret = process.env.CRON_SECRET, prevUrl = process.env.DATABASE_URL;
    process.env.CRON_SECRET = "sekret"; process.env.DATABASE_URL = URL;
    try {
      const res = await GET(new Request("http://x/api/cron/collection-projection", { headers: { authorization: "Bearer sekret" } }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, lockAcquired: true });
      expect(typeof body.processed).toBe("number");
      expect(typeof body.durationMs).toBe("number");
    } finally { process.env.CRON_SECRET = prevSecret; process.env.DATABASE_URL = prevUrl; }
  });

  // --- Advisory lock --------------------------------------------------------------------------------------
  it("dos sweeps: uno tiene el lock, el otro sale limpio (already-running, no error)", async () => {
    const blocker = new PrismaClient({ datasourceUrl: withOne(URL!) });
    try {
      const held = await blocker.$queryRawUnsafe<Array<{ locked: boolean }>>(`SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS locked`);
      expect(held[0].locked).toBe(true); // otra sesión retiene el lock
      const blocked = await sweepPickupProjections({ databaseUrl: URL });
      expect(blocked).toMatchObject({ lockAcquired: false, processed: 0 });
      await blocker.$queryRawUnsafe(`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`);
      const ok = await sweepPickupProjections({ databaseUrl: URL });
      expect(ok.lockAcquired).toBe(true);
    } finally { await blocker.$disconnect(); }
  });

  it("el lock se libera aunque el sweep falle inesperadamente", async () => {
    // batchSize inválido → la lectura de pendientes lanza; el finally debe liberar el lock igual.
    await expect(sweepPickupProjections({ databaseUrl: URL, batchSize: -1 })).rejects.toThrow();
    const after = await sweepPickupProjections({ databaseUrl: URL }); // el lock quedó libre
    expect(after.lockAcquired).toBe(true);
  });

  // --- Procesamiento --------------------------------------------------------------------------------------
  it("procesa más de una página (batchSize pequeño) y vacía el pendiente", async () => {
    const { client, lines } = await makeOrder(1);
    await mkPicked(lines[0].lineId, client);
    await mkPicked(lines[0].lineId, client);
    await mkPicked(lines[0].lineId, client);
    const s = await sweepPickupProjections({ databaseUrl: URL, batchSize: 1 });
    expect(s).toMatchObject({ lockAcquired: true, processed: 3, applied: 3, stoppedByTimeBudget: false });
    expect(await findPendingPickups(prisma, 100)).toHaveLength(0);
  });

  it("respeta orden y batch; corta por presupuesto; la 2da corrida recupera lo pendiente", async () => {
    const { client, lines } = await makeOrder(1);
    const a = await mkPicked(lines[0].lineId, client);
    const b = await mkPicked(lines[0].lineId, client);
    const c = await mkPicked(lines[0].lineId, client);
    const base = 1_000_000;
    let calls = 0;
    const nowFn = () => (calls++ < 3 ? base : base + 999_999); // corta tras procesar 1 evento
    const s1 = await sweepPickupProjections({ databaseUrl: URL, batchSize: 2, timeBudgetMs: 1000, nowFn });
    expect(s1).toMatchObject({ stoppedByTimeBudget: true, processed: 1, applied: 1 });
    const pending = (await findPendingPickups(prisma, 100)).map((p) => p.eventId).sort((x, y) => x - y);
    expect(pending).toEqual([b.id, c.id]); // 'a' (menor id) se aplicó; b y c quedan (orden asc respetado)
    const s2 = await sweepPickupProjections({ databaseUrl: URL, batchSize: 2 });
    expect(s2).toMatchObject({ processed: 2, applied: 2 });
    expect(await findPendingPickups(prisma, 100)).toHaveLength(0);
  });

  it("un evento reintentable no bloquea a los siguientes; queda pendiente para la próxima corrida", async () => {
    const { client, lines } = await makeOrder(3);
    const a = await mkPicked(lines[0].lineId, client);
    await mkPicked(lines[1].lineId, client);
    await mkPicked(lines[2].lineId, client);
    // Fuerza RETRYABLE en 'a': su posición ya está en el máximo INT4 → el incremento desborda.
    await prisma.ownershipPosition.create({ data: { userId: client, volumeId: lines[0].volumeId, quantity: 2147483647 } });
    const s = await sweepPickupProjections({ databaseUrl: URL, batchSize: 10 });
    expect(s).toMatchObject({ processed: 3, applied: 2, retryableFailure: 1 });
    expect((await findPendingPickups(prisma, 100)).map((p) => p.eventId)).toEqual([a.id]); // 'a' sigue pendiente
  });

  it("conjunto vacío termina correctamente", async () => {
    const s = await sweepPickupProjections({ databaseUrl: URL });
    expect(s).toMatchObject({ lockAcquired: true, processed: 0, applied: 0, alreadyApplied: 0, stoppedByTimeBudget: false });
    expect(typeof s.durationMs).toBe("number");
  });
});
