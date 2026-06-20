import { prisma } from "@/lib/prisma";

/**
 * Deseados POR EDICIÓN. `editionKey`: "" = legacy/cualquier edición; una key
 * puntual ("ivrea"/"viz"/…) ata el deseo a esa edición, así las notis y "ya
 * salió" no mezclan ediciones de la misma serie.
 */

export async function getWishlist(userId: string) {
  return prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/** ¿La obra está deseada en ALGUNA edición? (highlight de las cards). */
export async function isWishedAny(
  userId: string,
  anilistId: number,
): Promise<boolean> {
  const row = await prisma.wishlistItem.findFirst({
    where: { userId, anilistId },
    select: { id: true },
  });
  return !!row;
}

/** Keys de edición deseadas para una obra (estado por-edición en la ficha). */
export async function getWishedKeys(
  userId: string,
  anilistId: number,
): Promise<string[]> {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId, anilistId },
    select: { editionKey: true },
  });
  return rows.map((r) => r.editionKey);
}

/** ¿Deseada en esta edición puntual? */
export async function isWished(
  userId: string,
  anilistId: number,
  editionKey = "",
): Promise<boolean> {
  const row = await prisma.wishlistItem.findUnique({
    where: { userId_anilistId_editionKey: { userId, anilistId, editionKey } },
    select: { id: true },
  });
  return !!row;
}

/** ¿La edición deseada ya tiene tomos publicados (disponible)? */
async function editionAvailable(
  anilistId: number,
  editionKey: string,
  publisher?: string | null,
): Promise<boolean> {
  const work = anilistId < 0 ? { workId: -anilistId } : { anilistId };
  // Edición puntual → solo esa editorial; "" (cualquiera) → cualquier edición.
  const pubFilter = editionKey && publisher ? { publisher } : {};
  const n = await prisma.publisherEdition.count({
    where: { ...work, ...pubFilter, volumes: { gt: 0 } },
  });
  return n > 0;
}

export async function addWish(
  userId: string,
  item: {
    anilistId: number;
    title: string;
    coverImage: string;
    editionKey?: string;
    publisher?: string | null;
    region?: string | null;
  },
) {
  const editionKey = item.editionKey ?? "";
  // Si la edición deseada YA está disponible, no corresponde alertar "salió"
  // (ya lo sabés) → marcamos notificado.
  const alreadyAvailable = await editionAvailable(
    item.anilistId,
    editionKey,
    item.publisher,
  );
  await prisma.wishlistItem.upsert({
    where: {
      userId_anilistId_editionKey: {
        userId,
        anilistId: item.anilistId,
        editionKey,
      },
    },
    update: {},
    create: {
      userId,
      anilistId: item.anilistId,
      editionKey,
      publisher: item.publisher ?? null,
      region: item.region ?? null,
      title: item.title,
      coverImage: item.coverImage,
      notifiedAvailable: alreadyAvailable,
    },
  });
}

export async function removeWish(
  userId: string,
  anilistId: number,
  editionKey = "",
) {
  await prisma.wishlistItem.deleteMany({ where: { userId, anilistId, editionKey } });
}
