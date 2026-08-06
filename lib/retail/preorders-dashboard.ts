/**
 * Infra de Retail — loader de la Home de Preventas de una tienda (datos REALES). Reúne, para un `storeId`:
 * los seis indicadores y las filas de campañas con su etapa visible, cantidades y montos. La ETAPA se DERIVA
 * (dominio puro `deriveCampaignStage`), no se persiste. Filtro/orden/paginación se resuelven en memoria: a
 * escala de una tienda el número de campañas es chico y evita SQL por-etapa (la etapa es derivada).
 *
 * La autorización NO vive acá: la hace la página con `requireStoreMember` antes de invocar este loader.
 */
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { CAMPAIGN_STATUS, type CampaignStatus } from "@/lib/domain/retail/campaign";
import {
  deriveCampaignStage,
  sameMonth,
  type StoreStage,
  type CampaignFulfillmentTotals,
} from "@/lib/domain/retail/pipeline-stage";

const PAGE_SIZE = 8;
const ZERO_TOTALS: CampaignFulfillmentTotals = { quantity: 0, ordered: 0, arrived: 0, cancelled: 0, prepared: 0, pickedUp: 0 };

export type SortKey = "recientes" | "antiguas" | "cierre";
const SORT_KEYS: readonly SortKey[] = ["recientes", "antiguas", "cierre"];

export interface DashboardQuery {
  q?: string;
  stage?: string; // "" | StoreStage
  sort?: string;  // SortKey
  page?: number;
}

export interface PreorderKpis {
  activas: number;
  porCerrar: number;
  esperandoLlegada: number;
  entregando: number;
  finalizadasMes: number;
  reservadoMesCents: number;
}

export interface CloseView {
  label?: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
  muted?: boolean;
}

export interface PreorderRow {
  id: number;
  title: string;
  publishers: string[];
  extraCount: number; // editoriales más allá de las 3 mostradas
  stage: StoreStage;
  close: CloseView;
  titulos: number;
  reservas: number;
  reservadoCents: number;
  covers: number;
  cta: "estudio" | "resumen";
}

export interface PreordersDashboard {
  kpis: PreorderKpis;
  rows: PreorderRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  stage: string;
  sort: SortKey;
}

type Client = Pick<PrismaClient, "preorderCampaign" | "preorderOffer" | "storeOrder" | "$queryRaw">;

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function relativeDays(closesAt: Date, now: Date): string {
  const diff = Math.round((startOfDay(closesAt).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff < 0) return "cerró";
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  return `en ${diff} días`;
}

/** Columna "Cierre" en lenguaje cotidiano, derivada de la etapa + fechas. PURA (now inyectado). */
function formatClose(stage: StoreStage, closesAt: Date | null, closedAt: Date | null, now: Date): CloseView {
  if (stage === "abierta" || stage === "por_cerrar") {
    if (!closesAt) return { label: "—", primary: "Sin fecha", muted: true };
    const date = `${WEEKDAYS[closesAt.getDay()]} ${pad(closesAt.getDate())}/${pad(closesAt.getMonth() + 1)}`;
    return { label: "Cierre", primary: date, secondary: `${pad(closesAt.getHours())}:${pad(closesAt.getMinutes())} hs`, tertiary: relativeDays(closesAt, now) };
  }
  if (stage === "finalizada" && closedAt) {
    return { primary: `${pad(closedAt.getDate())}/${pad(closedAt.getMonth() + 1)}`, secondary: "Completada", muted: true };
  }
  if (stage === "cancelada") return { label: "—", primary: "Cancelada", muted: true };
  return { label: "—", primary: "Sin fecha", muted: true };
}

interface LineTotalsRow { campaignId: number; quantity: number; ordered: number; arrived: number; cancelled: number; prepared: number; pickedUp: number }

export async function loadPreordersDashboard(
  storeId: number,
  query: DashboardQuery = {},
  client: Client = prisma,
  now: Date = new Date(),
): Promise<PreordersDashboard> {
  const q = (query.q ?? "").trim();
  const stageFilter = (query.stage ?? "").trim();
  const sort: SortKey = SORT_KEYS.includes(query.sort as SortKey) ? (query.sort as SortKey) : "recientes";
  const page = Math.max(1, Math.floor(query.page ?? 1));

  const [campaigns, offerCounts, publisherRows, orderAgg, lineTotals, monthAgg] = await Promise.all([
    client.preorderCampaign.findMany({
      where: { storeId },
      select: { id: true, title: true, status: true, opensAt: true, closesAt: true, closedAt: true, createdAt: true },
    }),
    client.preorderOffer.groupBy({
      by: ["campaignId"],
      where: { campaign: { storeId }, status: "ACTIVE" },
      _count: { _all: true },
    }),
    client.preorderOffer.findMany({
      where: { campaign: { storeId }, status: "ACTIVE", publisherSnapshot: { not: null } },
      select: { campaignId: true, publisherSnapshot: true },
      distinct: ["campaignId", "publisherSnapshot"],
      orderBy: [{ campaignId: "asc" }, { publisherSnapshot: "asc" }],
    }),
    client.storeOrder.groupBy({
      by: ["campaignId"],
      where: { storeId, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    client.$queryRaw<LineTotalsRow[]>`
      SELECT o."campaignId" AS "campaignId",
             COALESCE(SUM(l.quantity), 0)::int            AS "quantity",
             COALESCE(SUM(l."orderedQuantity"), 0)::int   AS "ordered",
             COALESCE(SUM(l."arrivedQuantity"), 0)::int   AS "arrived",
             COALESCE(SUM(l."cancelledQuantity"), 0)::int AS "cancelled",
             COALESCE(SUM(l."preparedQuantity"), 0)::int  AS "prepared",
             COALESCE(SUM(l."pickedUpQuantity"), 0)::int  AS "pickedUp"
      FROM "StoreOrderLine" l
      JOIN "StoreOrder" o ON o.id = l."orderId"
      WHERE o."storeId" = ${storeId} AND o.status <> 'CANCELLED'
      GROUP BY o."campaignId"`,
    client.storeOrder.aggregate({
      where: { storeId, status: { not: "CANCELLED" }, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      _sum: { totalCents: true },
    }),
  ]);

  const titulosBy = new Map(offerCounts.map((r) => [r.campaignId, r._count._all]));
  const ordersBy = new Map(orderAgg.map((r) => [r.campaignId, { count: r._count._all, sum: r._sum.totalCents ?? 0 }]));
  const totalsBy = new Map<number, CampaignFulfillmentTotals>(
    lineTotals.map((r) => [r.campaignId, { quantity: r.quantity, ordered: r.ordered, arrived: r.arrived, cancelled: r.cancelled, prepared: r.prepared, pickedUp: r.pickedUp }]),
  );
  const publishersBy = new Map<number, string[]>();
  for (const r of publisherRows) {
    if (!r.publisherSnapshot) continue;
    const list = publishersBy.get(r.campaignId) ?? [];
    list.push(r.publisherSnapshot);
    publishersBy.set(r.campaignId, list);
  }

  interface Built { row: PreorderRow; stage: StoreStage; createdAt: Date; closesAt: Date | null; closedAt: Date | null }
  const built: Built[] = campaigns.map((c) => {
    const totals = totalsBy.get(c.id) ?? ZERO_TOTALS;
    const stage = deriveCampaignStage(
      { status: c.status as CampaignStatus, opensAt: c.opensAt, closesAt: c.closesAt, totals },
      now,
    );
    const orders = ordersBy.get(c.id) ?? { count: 0, sum: 0 };
    const titulos = titulosBy.get(c.id) ?? 0;
    const allPublishers = publishersBy.get(c.id) ?? [];
    return {
      stage,
      createdAt: c.createdAt,
      closesAt: c.closesAt,
      closedAt: c.closedAt,
      row: {
        id: c.id,
        title: c.title,
        publishers: allPublishers.slice(0, 3),
        extraCount: Math.max(0, allPublishers.length - 3),
        stage,
        close: formatClose(stage, c.closesAt, c.closedAt, now),
        titulos,
        reservas: orders.count,
        reservadoCents: orders.sum,
        covers: Math.min(3, titulos),
        cta: stage === "finalizada" || stage === "cancelada" ? "resumen" : "estudio",
      },
    };
  });

  // KPIs sobre TODAS las campañas (no sobre el subconjunto filtrado).
  const kpis: PreorderKpis = {
    activas: built.filter((b) => b.stage === "abierta").length,
    porCerrar: built.filter((b) => b.stage === "por_cerrar").length,
    esperandoLlegada: built.filter((b) => b.stage === "esperando_llegada").length,
    entregando: built.filter((b) => b.stage === "entregando").length,
    finalizadasMes: built.filter((b) => b.stage === "finalizada" && b.closedAt != null && sameMonth(b.closedAt, now)).length,
    reservadoMesCents: monthAgg._sum.totalCents ?? 0,
  };

  // Filtro → orden → paginación (en memoria; escala de tienda).
  const qLower = q.toLowerCase();
  let filtered = built.filter((b) => (qLower ? b.row.title.toLowerCase().includes(qLower) : true));
  if (stageFilter) filtered = filtered.filter((b) => b.stage === stageFilter);

  filtered.sort((a, b) => {
    if (sort === "antiguas") return a.createdAt.getTime() - b.createdAt.getTime();
    if (sort === "cierre") {
      const av = a.closesAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bv = b.closesAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
    return b.createdAt.getTime() - a.createdAt.getTime(); // recientes
  });

  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE).map((b) => b.row);

  return { kpis, rows, total, page, pageSize: PAGE_SIZE, q, stage: stageFilter, sort };
}
