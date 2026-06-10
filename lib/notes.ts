import { prisma } from "@/lib/prisma";

export async function getNote(userId: string, anilistId: number) {
  return prisma.userNote.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
  });
}

export async function setNote(
  userId: string,
  anilistId: number,
  data: { rating: number | null; note: string | null },
) {
  await prisma.userNote.upsert({
    where: { userId_anilistId: { userId, anilistId } },
    update: { rating: data.rating, note: data.note },
    create: {
      userId,
      anilistId,
      rating: data.rating,
      note: data.note,
    },
  });
}
