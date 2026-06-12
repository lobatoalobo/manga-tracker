import { prisma } from "@/lib/prisma";

export async function getLoginEvents(page = 1, perPage = 50) {
  const safePage = Math.max(1, page);
  const [total, events] = await Promise.all([
    prisma.loginEvent.count(),
    prisma.loginEvent.findMany({
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * perPage,
      take: perPage,
    }),
  ]);
  return { events, total, lastPage: Math.max(1, Math.ceil(total / perPage)) };
}
