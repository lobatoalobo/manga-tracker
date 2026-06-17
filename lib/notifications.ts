import { prisma } from "@/lib/prisma";

export async function getNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

/** Borra una notificación (solo si es del usuario). */
export async function deleteNotification(
  userId: string,
  id: number,
): Promise<void> {
  await prisma.notification.deleteMany({ where: { id, userId } });
}

/** Borra todas las notificaciones del usuario. */
export async function deleteAllNotifications(userId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId } });
}
