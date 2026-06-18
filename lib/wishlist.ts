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
  // Si la serie YA tiene edición AR disponible al agregarla a deseados, no
  // corresponde alertar "salió en Argentina" (ya lo sabés) → marcamos notificado.
  // Obras locales = anilistId negativo (-workId); el resto, por anilistId.
  const alreadyAvailable =
    (await prisma.publisherEdition.count({
      where: {
        volumes: { gt: 0 },
        ...(item.anilistId < 0
          ? { workId: -item.anilistId }
          : { anilistId: item.anilistId }),
      },
    })) > 0;
  await prisma.wishlistItem.upsert({
    where: { userId_anilistId: { userId, anilistId: item.anilistId } },
    update: {},
    create: {
      userId,
      anilistId: item.anilistId,
      title: item.title,
      coverImage: item.coverImage,
      notifiedAvailable: alreadyAvailable,
    },
  });
}

export async function removeWish(userId: string, anilistId: number) {
  await prisma.wishlistItem.deleteMany({ where: { userId, anilistId } });
}
