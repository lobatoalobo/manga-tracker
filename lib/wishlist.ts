import { prisma } from "@/lib/prisma";

export async function getWishlist(userId: string) {
  return prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function isWished(
  userId: string,
  anilistId: number,
): Promise<boolean> {
  const row = await prisma.wishlistItem.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    select: { id: true },
  });
  return !!row;
}

export async function addWish(
  userId: string,
  item: { anilistId: number; title: string; coverImage: string },
) {
  await prisma.wishlistItem.upsert({
    where: { userId_anilistId: { userId, anilistId: item.anilistId } },
    update: {},
    create: {
      userId,
      anilistId: item.anilistId,
      title: item.title,
      coverImage: item.coverImage,
    },
  });
}

export async function removeWish(userId: string, anilistId: number) {
  await prisma.wishlistItem.deleteMany({ where: { userId, anilistId } });
}
