import { prisma } from "@/lib/prisma";

export interface PurchaseInput {
  title: string;
  anilistId?: number | null;
  volume?: number | null;
  edition?: string | null;
  price: number;
  store?: string | null;
  status?: "ORDERED" | "RECEIVED";
  purchasedAt?: Date | null;
}

export async function getPurchases(userId: string) {
  return prisma.purchase.findMany({
    where: { userId },
    orderBy: { purchasedAt: "desc" },
  });
}

export async function addPurchase(userId: string, input: PurchaseInput) {
  await prisma.purchase.create({
    data: {
      userId,
      title: input.title.trim(),
      anilistId: input.anilistId ?? null,
      volume: input.volume ?? null,
      edition: clean(input.edition),
      price: input.price,
      store: clean(input.store),
      status: input.status ?? "ORDERED",
      purchasedAt: input.purchasedAt ?? new Date(),
      receivedAt: input.status === "RECEIVED" ? new Date() : null,
    },
  });
}

export async function setPurchaseStatus(
  userId: string,
  id: number,
  status: "ORDERED" | "RECEIVED",
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
  total: number; // total invertido (ARS)
  count: number;
  thisMonth: number;
  thisYear: number;
  pending: number; // pedidos no recibidos
}

export async function getPurchaseStats(userId: string): Promise<PurchaseStats> {
  const rows = await prisma.purchase.findMany({
    where: { userId },
    select: { price: true, purchasedAt: true, status: true },
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let total = 0;
  let thisMonth = 0;
  let thisYear = 0;
  let pending = 0;

  for (const p of rows) {
    total += p.price;
    if (p.purchasedAt.getFullYear() === y) {
      thisYear += p.price;
      if (p.purchasedAt.getMonth() === m) thisMonth += p.price;
    }
    if (p.status !== "RECEIVED") pending++;
  }

  return { total, count: rows.length, thisMonth, thisYear, pending };
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}
