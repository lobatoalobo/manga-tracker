import { prisma } from "@/lib/prisma";

export type PurchaseStatus =
  | "PENDING"
  | "SHIPPED"
  | "DELAYED"
  | "RECEIVED"
  | "CANCELLED";

export interface PurchaseItemInput {
  title: string;
  anilistId?: number | null;
  coverImage?: string | null;
  volume?: number | null;
  edition?: string | null;
  price: number;
  status?: PurchaseStatus;
}

export interface PurchaseInput {
  store?: string | null;
  status?: PurchaseStatus; // estado inicial aplicado a todos los tomos
  note?: string | null;
  discount?: number | null; // % de descuento sobre el subtotal
  purchasedAt?: Date | null;
  items: PurchaseItemInput[];
}

const STATUSES: PurchaseStatus[] = [
  "PENDING",
  "SHIPPED",
  "DELAYED",
  "RECEIVED",
  "CANCELLED",
];

export function normalizeStatus(v: string | null | undefined): PurchaseStatus {
  return STATUSES.includes(v as PurchaseStatus)
    ? (v as PurchaseStatus)
    : "RECEIVED";
}

/** % de descuento válido (0–100). */
export function clampDiscount(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

const applyDiscount = (subtotal: number, discount: number) =>
  subtotal * (1 - discount / 100);

/** Compras del usuario (con subtotal, total con descuento y ahorro). */
export async function getPurchases(userId: string) {
  const rows = await prisma.purchase.findMany({
    where: { userId },
    orderBy: { purchasedAt: "desc" },
    include: { items: true },
  });
  return rows.map((p) => {
    const subtotal = p.items.reduce((s, i) => s + i.price, 0);
    const total = applyDiscount(subtotal, p.discount);
    return { ...p, subtotal, total, saved: subtotal - total };
  });
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
      status: normalizeStatus(i.status ?? status),
    }));

  return prisma.purchase.create({
    data: {
      userId,
      store: clean(input.store),
      status,
      note: clean(input.note),
      discount: clampDiscount(input.discount),
      purchasedAt: input.purchasedAt ?? new Date(),
      receivedAt: status === "RECEIVED" ? new Date() : null,
      items: { create: items },
    },
    include: { items: true },
  });
}

export interface UpdatePurchaseItem extends PurchaseItemInput {
  id?: number | null; // presente = tomo existente; ausente = tomo nuevo
}

export interface UpdatePurchaseInput {
  store?: string | null;
  note?: string | null;
  discount?: number | null;
  purchasedAt?: Date | null;
  items: UpdatePurchaseItem[];
}

/**
 * Edita una compra: actualiza encabezado, modifica los tomos existentes (por
 * id, preservando su estado), borra los que se quitaron y crea los nuevos.
 * Devuelve los tomos nuevos (para, si corresponde, sumarlos a la colección).
 */
export async function updatePurchase(
  userId: string,
  id: number,
  input: UpdatePurchaseInput,
) {
  const existing = await prisma.purchase.findFirst({
    where: { id, userId },
    select: {
      id: true,
      items: {
        select: {
          id: true,
          anilistId: true,
          edition: true,
          volume: true,
          status: true,
        },
      },
    },
  });
  if (!existing) return null;
  const before = new Map(existing.items.map((b) => [b.id, b]));

  const items = input.items.filter(
    (i) => i.title.trim() && Number.isFinite(i.price),
  );
  const fields = (i: UpdatePurchaseItem) => ({
    title: i.title.trim(),
    anilistId: i.anilistId ?? null,
    coverImage: clean(i.coverImage),
    volume: i.volume ?? null,
    edition: clean(i.edition),
    price: i.price,
  });

  const keepIds = items.filter((i) => i.id).map((i) => i.id as number);
  await prisma.purchaseItem.deleteMany({
    where: { purchaseId: id, id: { notIn: keepIds.length ? keepIds : [-1] } },
  });

  for (const i of items.filter((i) => i.id)) {
    // updateMany acotado a purchaseId (la compra ya verificada como del usuario):
    // evita que un id de ítem ajeno sobrescriba datos de la compra de otro.
    await prisma.purchaseItem.updateMany({
      where: { id: i.id as number, purchaseId: id },
      data: fields(i), // no toca status (se maneja por tomo)
    });
  }

  const created = [];
  for (const i of items.filter((i) => !i.id)) {
    const c = await prisma.purchaseItem.create({
      data: {
        purchaseId: id,
        ...fields(i),
        status: normalizeStatus(i.status),
      },
    });
    created.push(c);
  }

  await prisma.purchase.update({
    where: { id },
    data: {
      store: clean(input.store),
      note: clean(input.note),
      discount: clampDiscount(input.discount),
      ...(input.purchasedAt ? { purchasedAt: input.purchasedAt } : {}),
    },
  });

  // Diff para sincronizar la colección: tomos quitados de la compra y tomos
  // cuya serie/edición/número cambió (su contribución vieja hay que quitarla).
  const keepIdSet = new Set(keepIds);
  const removed: SyncItem[] = existing.items
    .filter((b) => !keepIdSet.has(b.id))
    .map((b) => ({
      anilistId: b.anilistId,
      edition: b.edition,
      volume: b.volume,
      status: b.status,
    }));
  const changed: { before: SyncItem; after: AddItem }[] = [];
  for (const i of items.filter((i) => i.id)) {
    const b = before.get(i.id as number);
    if (!b) continue;
    const ed = clean(i.edition);
    if (
      b.anilistId !== (i.anilistId ?? null) ||
      (b.edition ?? null) !== (ed ?? null) ||
      (b.volume ?? null) !== (i.volume ?? null)
    ) {
      changed.push({
        before: {
          anilistId: b.anilistId,
          edition: b.edition,
          volume: b.volume,
          status: b.status,
        },
        // El status del ítem existente no cambia al editar (se maneja aparte).
        after: {
          anilistId: i.anilistId ?? null,
          title: i.title.trim(),
          coverImage: clean(i.coverImage),
          volume: i.volume ?? null,
          edition: ed,
          status: b.status,
        },
      });
    }
  }

  return { created, removed, changed };
}

/** Cambia el estado de un tomo (verifica que la compra sea del usuario). */
export async function setPurchaseItemStatus(
  userId: string,
  itemId: number,
  status: PurchaseStatus,
) {
  const item = await prisma.purchaseItem.findFirst({
    where: { id: itemId, purchase: { userId } },
    select: { id: true },
  });
  if (!item) return;
  await prisma.purchaseItem.update({
    where: { id: itemId },
    data: { status },
  });
}

/** Tomo de una compra, para sincronizar la colección al borrar/editar. */
export interface SyncItem {
  anilistId: number | null;
  edition: string | null;
  volume: number | null;
  status: string;
}

/** Dato suficiente para (re)agregar un tomo a la colección. */
export interface AddItem {
  anilistId: number | null;
  title: string;
  coverImage: string | null;
  volume: number | null;
  edition: string | null;
  status: string;
}

/** Borra una compra y devuelve sus tomos (para quitarlos de la colección). */
export async function deletePurchase(
  userId: string,
  id: number,
): Promise<SyncItem[]> {
  const purchase = await prisma.purchase.findFirst({
    where: { id, userId },
    select: {
      items: {
        select: { anilistId: true, edition: true, volume: true, status: true },
      },
    },
  });
  if (!purchase) return [];
  await prisma.purchase.deleteMany({ where: { id, userId } });
  return purchase.items;
}

export interface PurchaseStats {
  total: number; // total invertido (con descuento), excluye canceladas
  grossTotal: number; // total sin descuento
  saved: number; // ahorrado por descuentos
  count: number; // compras
  tomos: number; // ítems
  thisMonth: number;
  thisYear: number;
  avgMonthly: number; // promedio mensual (meses con actividad)
  avgPerVolume: number; // gasto promedio por tomo (con descuento)
  pending: number; // pendientes/enviadas
  firstYear: number; // año de la primera compra (para el selector)
}

type StatItem = {
  price: number; // sin descuento
  net: number; // con descuento de la compra aplicado
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
      status: true,
      purchase: { select: { purchasedAt: true, discount: true } },
    },
  });
  return rows.map((r) => ({
    price: r.price,
    net: applyDiscount(r.price, r.purchase.discount),
    edition: r.edition,
    title: r.title,
    at: r.purchase.purchasedAt,
    status: r.status,
  }));
}

export async function getPurchaseStats(userId: string): Promise<PurchaseStats> {
  const all = await loadItems(userId);
  const items = all.filter((i) => i.status !== "CANCELLED");
  // Compras con al menos un tomo no cancelado.
  const purchases = await prisma.purchase.count({
    where: { userId, items: { some: { status: { not: "CANCELLED" } } } },
  });
  // Tomos todavía en camino (no recibidos ni cancelados).
  const pending = all.filter((i) =>
    ["PENDING", "SHIPPED", "DELAYED"].includes(i.status),
  ).length;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let total = 0;
  let grossTotal = 0;
  let thisMonth = 0;
  let thisYear = 0;
  const months = new Set<string>();

  for (const it of items) {
    total += it.net;
    grossTotal += it.price;
    months.add(`${it.at.getFullYear()}-${it.at.getMonth()}`);
    if (it.at.getFullYear() === y) {
      thisYear += it.net;
      if (it.at.getMonth() === m) thisMonth += it.net;
    }
  }

  const firstYear = items.length
    ? Math.min(...items.map((i) => i.at.getFullYear()))
    : y;

  return {
    total,
    grossTotal,
    saved: grossTotal - total,
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
  for (const it of items) out[it.at.getMonth()] += it.net;
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
    map.set(k, (map.get(k) ?? 0) + it.net);
  }
  return [...map.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}
