import { prisma } from "@/lib/prisma";

const USER_SEL = { id: true, name: true, image: true } as const;

// --- Amigos ---

export async function getFriends(userId: string) {
  const fs = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: { requester: { select: USER_SEL }, addressee: { select: USER_SEL } },
  });
  return fs.map((f) => (f.requesterId === userId ? f.addressee : f.requester));
}

export async function getPendingRequests(userId: string) {
  const fs = await prisma.friendship.findMany({
    where: { status: "PENDING", addresseeId: userId },
    include: { requester: { select: USER_SEL } },
    orderBy: { createdAt: "desc" },
  });
  return fs.map((f) => ({ friendshipId: f.id, user: f.requester }));
}

export async function countPendingRequests(userId: string): Promise<number> {
  return prisma.friendship.count({
    where: { status: "PENDING", addresseeId: userId },
  });
}

export async function sendFriendRequest(
  userId: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  const target = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!target) return { ok: false, error: "No hay ningún usuario con ese email." };
  if (target.id === userId)
    return { ok: false, error: "Ese sos vos 🙂" };

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: target.id },
        { requesterId: target.id, addresseeId: userId },
      ],
    },
  });
  if (existing) {
    return {
      ok: false,
      error:
        existing.status === "ACCEPTED"
          ? "Ya son amigos."
          : "Ya hay una solicitud pendiente.",
    };
  }

  await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: target.id },
  });
  return { ok: true };
}

export async function respondFriendRequest(
  userId: string,
  friendshipId: number,
  accept: boolean,
) {
  const fr = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!fr || fr.addresseeId !== userId) return;
  if (accept) {
    await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: "ACCEPTED" },
    });
  } else {
    await prisma.friendship.delete({ where: { id: friendshipId } });
  }
}

export async function removeFriend(userId: string, otherId: string) {
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: otherId },
        { requesterId: otherId, addresseeId: userId },
      ],
    },
  });
}

// --- Actividad ---

export async function logActivity(
  userId: string,
  data: {
    type: "ADDED_EDITION" | "MARKED_READ" | "COMPLETED";
    anilistId?: number | null;
    title?: string | null;
    coverImage?: string | null;
    detail?: string | null;
  },
) {
  await prisma.activity.create({ data: { userId, ...data } });
}

export async function getFriendsFeed(userId: string) {
  const fs = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = fs.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId,
  );
  if (friendIds.length === 0) return [];

  const acts = await prisma.activity.findMany({
    where: { userId: { in: friendIds } },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: {
      user: { select: USER_SEL },
      reactions: true,
      comments: {
        include: { user: { select: USER_SEL } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return acts.map((a) => {
    const counts: Record<string, number> = {};
    let myReaction: string | null = null;
    for (const r of a.reactions) {
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
      if (r.userId === userId) myReaction = r.emoji;
    }
    return {
      id: a.id,
      type: a.type,
      anilistId: a.anilistId,
      title: a.title,
      coverImage: a.coverImage,
      detail: a.detail,
      createdAt: a.createdAt,
      user: a.user,
      reactions: counts,
      myReaction,
      comments: a.comments.map((c) => ({
        id: c.id,
        text: c.text,
        createdAt: c.createdAt,
        user: c.user,
      })),
    };
  });
}

// --- Reacciones y comentarios ---

export async function toggleReaction(
  userId: string,
  activityId: number,
  emoji: string,
) {
  const existing = await prisma.activityReaction.findUnique({
    where: { activityId_userId: { activityId, userId } },
  });
  if (existing && existing.emoji === emoji) {
    await prisma.activityReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.activityReaction.upsert({
      where: { activityId_userId: { activityId, userId } },
      update: { emoji },
      create: { activityId, userId, emoji },
    });
  }
}

export async function addComment(
  userId: string,
  activityId: number,
  text: string,
) {
  const t = text.trim();
  if (!t) return;
  await prisma.activityComment.create({
    data: { activityId, userId, text: t.slice(0, 500) },
  });
}

export async function deleteComment(userId: string, commentId: number) {
  await prisma.activityComment.deleteMany({ where: { id: commentId, userId } });
}
