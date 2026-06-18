import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@nakama.app";

let configured = false;
function ensure(): boolean {
  if (!PUBLIC || !PRIVATE) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
  }
  return true;
}

export interface WebPushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(userId: string, sub: WebPushSub) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function deleteSubscription(userId: string, endpoint: string) {
  // Acotado al userId: un usuario no puede desuscribir el dispositivo de otro.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Envía un push a todos los dispositivos del usuario (best-effort). */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensure()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          // urgency "high" + TTL: le pide al push service que despierte el
          // dispositivo y entregue aunque la app esté cerrada / en bajo consumo.
          { urgency: "high", TTL: 60 * 60 * 24 },
        );
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410)
          await prisma.pushSubscription.deleteMany({
            where: { endpoint: s.endpoint },
          });
      }
    }),
  );
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  await Promise.all(userIds.map((u) => sendPushToUser(u, payload)));
}
