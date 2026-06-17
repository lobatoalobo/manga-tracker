import { prisma } from "@/lib/prisma";

export type NotifCategory =
  | "newVolume"
  | "reissue"
  | "wishlist"
  | "social"
  | "friends";

export interface NotifPrefs {
  newVolume: boolean;
  reissue: boolean;
  wishlist: boolean;
  social: boolean;
  friends: boolean;
}

const DEFAULTS: NotifPrefs = {
  newVolume: true,
  reissue: true,
  wishlist: true,
  social: true,
  friends: true,
};

/** Mapea un tipo de notificación a su categoría de preferencia. */
export function notifCategory(type: string): NotifCategory | null {
  if (type === "NEW_VOLUME") return "newVolume";
  if (type === "REISSUE") return "reissue";
  if (type === "WISHLIST_AVAILABLE") return "wishlist";
  if (type === "REACTION" || type === "COMMENT") return "social";
  if (type === "FRIEND_REQUEST" || type === "FRIEND_ACCEPTED") return "friends";
  return null;
}

export async function getNotifPrefs(userId: string): Promise<NotifPrefs> {
  const row = await prisma.notificationPref.findUnique({ where: { userId } });
  return row
    ? {
        newVolume: row.newVolume,
        reissue: row.reissue,
        wishlist: row.wishlist,
        social: row.social,
        friends: row.friends,
      }
    : DEFAULTS;
}

export async function setNotifPref(
  userId: string,
  key: NotifCategory,
  value: boolean,
) {
  await prisma.notificationPref.upsert({
    where: { userId },
    create: { userId, [key]: value },
    update: { [key]: value },
  });
}

/** ¿El usuario silenció las notis de esta serie puntual? */
export async function isSeriesMuted(
  userId: string,
  anilistId: number,
): Promise<boolean> {
  const row = await prisma.seriesNotifMute.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    select: { userId: true },
  });
  return !!row;
}

/** ¿El usuario quiere recibir notificaciones de este tipo? (default sí). */
export async function notifEnabled(
  userId: string,
  type: string,
): Promise<boolean> {
  const cat = notifCategory(type);
  if (!cat) return true;
  return (await getNotifPrefs(userId))[cat];
}

/** Filtra una lista de usuarios a los que tienen ese tipo activado. */
export async function filterNotifEnabled(
  userIds: string[],
  type: string,
): Promise<string[]> {
  const cat = notifCategory(type);
  if (!cat || userIds.length === 0) return userIds;
  const rows = await prisma.notificationPref.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true, newVolume: true, reissue: true, wishlist: true,
      social: true, friends: true,
    },
  });
  const off = new Set(rows.filter((r) => !r[cat]).map((r) => r.userId));
  return userIds.filter((u) => !off.has(u)); // sin fila = default activado
}
