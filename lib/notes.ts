import { prisma } from "@/lib/prisma";

/** Reseñas públicas de una serie (puntaje y/o comentario), con el autor. */
export async function getSeriesNotes(anilistId: number) {
  const rows = await prisma.userNote.findMany({
    where: {
      anilistId,
      OR: [{ note: { not: null } }, { rating: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    include: { user: { select: { name: true, image: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    note: r.note,
    updatedAt: r.updatedAt,
    userName: r.user.name ?? "Usuario",
    userImage: r.user.image,
  }));
}

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
