import { prisma } from "@/lib/prisma";

export type PurchaseStatus = "PENDING" | "SHIPPED" | "RECEIVED" | "CANCELLED";

export interface PurchaseItemInput {
  title: string;
  anilistId?: number | null;
  coverImage?: string | null;
  volume?: number | null;
  edition?: string | null;
  price: number;
}

export interface PurchaseInput {
  store?: string | null;
  status?: PurchaseStatus;
  note?: string | null;
  purchasedAt?: Date | null;
  items: PurchaseItemInput[];
}

const STATUSES: PurchaseStatus[] = [
  "PENDING",
  "SHIPPED",
  "RECEIVED",
  "CANCELLED",
];

export function normalizeStatus(v: string | null | undefined): PurchaseStatus {
  return STATUSES.includes(v as PurchaseStatus)
    ? (v as PurchaseStatus)
    : "RECEIVED";
}

/** Compras del usuario (con sus tomos y el total calculado), más nuevas primero. */
export async function getPurchases(userId: string) {
  const rows = await prisma.purchase.findMany({
    where: { userId },
    orderBy: { purchasedAt: "desc" },
    include: { items: true },
  });
  return rows.map((p) => ({
    ...p,
    total: p.items.reduce((s, i) => s + i.price, 0),
  }));
}

export type PurchaseWithTotal = Awaited<
  ReturnType<typeof getPurchases>
>[number];

export async function addPurchase(userId: string, input: PurchaseInput) {
  const status = normalizeStatus(input.status);
  const items = input.items
    .filter((i) => i.title.trim() && Number.isFinite(i.price))
    .map((i) => ({
      title: i.title.trim(),
      anilistId: i.anilistId ?? null,
      coverImage: clean(i.coverImage),
      volume: i.volume ?? null,
      edition: clean(i.edition),
      price: i.price,
    }));

  return prisma.purchase.create({
    data: {
      userId,
      store: clean(input.store),
      status,
      note: clean(input.note),
      purchasedAt: input.purchasedAt ?? new Date(),
      receivedAt: status === "RECEIVED" ? new Date() : null,
      items: { create: items },
    },
    include: { items: true },
  });
}

export async function setPurchaseStatus(
  userId: string,
  id: number,
  status: PurchaseStatus,
) {
  await prisma.purchase.updateMany({
    where: { id, userId },
    data: { status, receivedAt: status === "RECEIVED" ? new Date() : null },
  });
}

export async function deletePurchase(userId: string, id: number) {
  await prisma.purchase.deleteMany({ where: { id, userId } });
}

export interface PurchaseStats {
  total: number; // total invertido (ARS), excluye canceladas
  count: number; // compras
  tomos: number; // ítems
  thisMonth: number;
  thisYear: number;
  avgMonthly: number; // promedio mensual (meses con actividad)
  avgPerVolume: number; // gasto promedio por tomo
  pending: number; // pendientes/enviadas
  firstYear: number; // año de la primera compra (para el selector)
}

type StatItem = {
  price: number;
  edition: string | null;
  title: string;
  at: Date;
  status: string;
};

async function loadItems(userId: string): Promise<StatItem[]> {
  const rows = await prisma.purchaseItem.findMany({
    where: { purchase: { userId } },
    select: {
      price: true,
      edition: true,
      title: true,
      purchase: { select: { purchasedAt: true, status: true } },
    },
  });
  return rows.map((r) => ({
    price: r.price,
    edition: r.edition,
    title: r.title,
    at: r.purchase.purchasedAt,
    status: r.purchase.status,
  }));
}

export async function getPurchaseStats(userId: string): Promise<PurchaseStats> {
  const items = (await loadItems(userId)).filter(
    (i) => i.status !== "CANCELLED",
  );
  const purchases = await prisma.purchase.count({
    where: { userId, status: { not: "CANCELLED" } },
  });
  const pending = await prisma.purchase.count({
    where: { userId, status: { in: ["PENDING", "SHIPPED"] } },
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let total = 0;
  let thisMonth = 0;
  let thisYear = 0;
  const months = new Set<string>();

  for (const it of items) {
    total += it.price;
    months.add(`${it.at.getFullYear()}-${it.at.getMonth()}`);
    if (it.at.getFullYear() === y) {
      thisYear += it.price;
      if (it.at.getMonth() === m) thisMonth += it.price;
    }
  }

  const firstYear = items.length
    ? Math.min(...items.map((i) => i.at.getFullYear()))
    : y;

  return {
    total,
    count: purchases,
    tomos: items.length,
    thisMonth,
    thisYear,
    avgMonthly: months.size ? total / months.size : 0,
    avgPerVolume: items.length ? total / items.length : 0,
    pending,
    firstYear,
  };
}

/** Gasto por mes (ene..dic) de un año. Para el gráfico de barras. */
export async function getMonthlySpend(
  userId: string,
  year: number,
): Promise<number[]> {
  const items = (await loadItems(userId)).filter(
    (i) => i.status !== "CANCELLED" && i.at.getFullYear() === year,
  );
  const out = new Array(12).fill(0);
  for (const it of items) out[it.at.getMonth()] += it.price;
  return out;
}

/** Gasto agrupado por editorial (campo `edition` del tomo). */
export async function getStatsByPublisher(userId: string) {
  const items = (await loadItems(userId)).filter(
    (i) => i.status !== "CANCELLED",
  );
  return groupSum(items, (i) => i.edition?.trim() || "Sin editorial");
}

/** Gasto agrupado por serie (título del tomo). */
export async function getStatsBySeries(userId: string) {
  const items = (await loadItems(userId)).filter(
    (i) => i.status !== "CANCELLED",
  );
  return groupSum(items, (i) => i.title);
}

function groupSum(items: StatItem[], key: (i: StatItem) => string) {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    map.set(k, (map.get(k) ?? 0) + it.price);
  }
  return [...map.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}
