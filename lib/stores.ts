import { prisma } from "@/lib/prisma";

export interface StoreInput {
  name: string;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  phone?: string | null;
  hours?: string | null;
  website?: string | null;
  social?: string | null;
}

export async function getApprovedStores() {
  return prisma.store.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ province: "asc" }, { city: "asc" }, { name: "asc" }],
  });
}

export async function getPendingStores() {
  return prisma.store.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

export async function countPendingStores(): Promise<number> {
  return prisma.store.count({ where: { status: "PENDING" } });
}

export async function createStore(
  input: StoreInput,
  opts: { status?: "APPROVED" | "PENDING"; submittedBy?: string | null } = {},
) {
  await prisma.store.create({
    data: {
      name: input.name.trim(),
      address: clean(input.address),
      city: clean(input.city),
      province: clean(input.province),
      phone: clean(input.phone),
      hours: clean(input.hours),
      website: clean(input.website),
      social: clean(input.social),
      status: opts.status ?? "APPROVED",
      submittedBy: opts.submittedBy ?? null,
    },
  });
}

export async function setStoreStatus(
  id: number,
  status: "APPROVED" | "PENDING",
) {
  await prisma.store.update({ where: { id }, data: { status } });
}

export async function deleteStore(id: number) {
  await prisma.store.delete({ where: { id } });
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}
