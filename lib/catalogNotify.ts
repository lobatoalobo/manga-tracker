import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { filterNotifEnabled } from "@/lib/notificationPrefs";
import { sendPushToUsers } from "@/lib/push";

/**
 * Pone `notifiedVolumes = volumes` (sin notificar) para re-baselinar una
 * corrección de conteo: cuando un re-import sube `volumes` porque el dato viejo
 * estaba MAL (ej. Panini subcontaba Naruto 54 vs 72 real), NO es un tomo nuevo y
 * no debe spamear "tomo nuevo". Devuelve cuántas filas tocó.
 */
export async function baselineNotifiedVolumes(publisher?: string): Promise<number> {
  const where = publisher
    ? Prisma.sql`WHERE "publisher" = ${publisher}`
    : Prisma.empty;
  return prisma.$executeRaw`UPDATE "PublisherEdition" SET "notifiedVolumes" = "volumes" ${where}`;
}

const PUB_KEY: Record<string, string> = {
  "Ivrea Argentina": "ivrea",
  "Panini Argentina": "panini",
  "Ovni Press": "ovni",
  "Kemuri Ediciones": "kemuri",
  "Utopía Editorial": "utopia",
  "Larp Editores": "larp",
  "Distrito Manga": "distrito",
  "Planeta Cómic": "planeta",
};

export interface NewVolumeResult {
  scanned: number; // ediciones mapeadas chequeadas
  changed: number; // ediciones con tomo nuevo (incluye baseline silencioso)
  notifications: number; // notis creadas (o que se crearían en dry-run)
  samples: string[];
}

/**
 * Detecta ediciones mapeadas que sumaron tomos desde la última vez
 * (`notifiedVolumes`) y notifica "tomo nuevo" a quienes coleccionan esa edición.
 * La primera vez que ve una edición la baseliza en silencio (no notifica).
 * Con `dryRun` no crea notis ni actualiza el baseline.
 */
export async function detectAndNotifyNewVolumes(
  dryRun = false,
): Promise<NewVolumeResult> {
  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: { not: null }, volumes: { gt: 0 } },
    select: {
      id: true,
      anilistId: true,
      publisher: true,
      title: true,
      volumes: true,
      notifiedVolumes: true,
      work: { select: { upcoming: true } },
    },
  });

  const increased = rows.filter((r) => r.volumes > r.notifiedVolumes);
  let notifications = 0;
  const samples: string[] = [];

  // Acumulador para AGRUPAR el push: 1 push por usuario (no N), así una colección
  // grande no recibe decenas de push de golpe. Las notis in-app siguen por ítem.
  type Ev = { title: string; volumes: number; publisher: string; anilistId: number; releasing: boolean };
  const pushByUser = new Map<string, Ev[]>();

  for (const r of increased) {
    const anilistId = r.anilistId as number;

    // Primera vez que vemos la edición → baseline silencioso. EXCEPCIÓN: si la
    // obra está marcada "próximo a salir", este primer tomo es el lanzamiento
    // real en AR → no es baseline, lo tratamos como tomo nuevo (notifica + abajo
    // limpia el flag upcoming).
    if (r.notifiedVolumes === 0 && !r.work?.upcoming) {
      if (!dryRun)
        await prisma.publisherEdition.update({
          where: { id: r.id },
          data: { notifiedVolumes: r.volumes },
        });
      continue;
    }

    const pubKey = PUB_KEY[r.publisher];
    const tracked = await prisma.trackedEdition.findMany({
      where: {
        manga: { anilistId },
        OR: [{ publisher: r.publisher }, ...(pubKey ? [{ key: pubKey }] : [])],
      },
      select: { manga: { select: { userId: true } } },
    });
    const audience = tracked.map((t) => t.manga.userId);
    // Si era una preventa que recién sale, avisamos también a quienes la tienen
    // en DESEADOS (su público natural: querían comprarla cuando saliera).
    const releasing = !!r.work?.upcoming;
    if (releasing) {
      const wished = await prisma.wishlistItem.findMany({
        where: { anilistId },
        select: { userId: true },
      });
      audience.push(...wished.map((w) => w.userId));
    }
    const allUsers = [...new Set(audience)];
    const userIds = await filterNotifEnabled(allUsers, "NEW_VOLUME");

    if (userIds.length && samples.length < 20)
      samples.push(
        `${r.title} (${r.publisher}): ${r.notifiedVolumes}→${r.volumes} → ${userIds.length} usuario(s)`,
      );
    notifications += userIds.length;

    if (!dryRun) {
      if (userIds.length) {
        // In-app: una noti por ítem (el detalle vive en /notificaciones).
        await prisma.notification.createMany({
          data: userIds.map((userId) => ({
            userId,
            type: "NEW_VOLUME",
            actorName: r.title,
            anilistId,
            text: releasing
              ? `¡Ya salió! Tomo ${r.volumes} · ${r.publisher}`
              : `Tomo ${r.volumes} · ${r.publisher}`,
          })),
        });
        // Push: acumulamos para mandar UNO agrupado por usuario al final.
        for (const userId of userIds) {
          const arr = pushByUser.get(userId) ?? [];
          arr.push({ title: r.title, volumes: r.volumes, publisher: r.publisher, anilistId, releasing });
          pushByUser.set(userId, arr);
        }
      }
      await prisma.publisherEdition.update({
        where: { id: r.id },
        data: { notifiedVolumes: r.volumes },
      });
      // Si salió un tomo nuevo, la serie ya está a la venta → sacamos el flag
      // "próximo a salir" (el badge desaparece en toda la plataforma).
      await prisma.work.updateMany({
        where: { editions: { some: { id: r.id } }, upcoming: true },
        data: { upcoming: false },
      });
    }
  }

  // Un solo push por usuario, resumiendo sus novedades.
  if (!dryRun) {
    for (const [userId, evs] of pushByUser) {
      if (evs.length === 1) {
        const e = evs[0];
        await sendPushToUsers([userId], {
          title: e.releasing ? "🎉 ¡Ya salió!" : "📖 Tomo nuevo",
          body: `${e.title} — Tomo ${e.volumes} (${e.publisher})`,
          url: `/manga/${e.anilistId}`,
        });
      } else {
        const sample = evs.slice(0, 3).map((e) => e.title).join(", ");
        await sendPushToUsers([userId], {
          title: "📖 Novedades de tu colección",
          body: `${evs.length} novedades · ${sample}${evs.length > 3 ? "…" : ""}`,
          url: `/notificaciones`,
        });
      }
    }
  }

  return {
    scanned: rows.length,
    changed: increased.length,
    notifications,
    samples,
  };
}

/**
 * Avisa "🆕 Salió en Argentina" a quienes tienen una serie en DESEADOS que ahora
 * tiene edición AR disponible y todavía no fue avisada. Idempotente vía
 * `WishlistItem.notifiedAvailable` (no re-notifica; sin tormenta retroactiva
 * porque las ya-disponibles al agregar se marcan en `addWish`/backfill).
 * Push agrupado: 1 por usuario.
 */
export async function detectAndNotifyWishlistAvailable(
  dryRun = false,
): Promise<{ scanned: number; notifications: number; samples: string[] }> {
  const pending = await prisma.wishlistItem.findMany({
    where: { notifiedAvailable: false },
    select: { id: true, userId: true, anilistId: true, title: true },
  });
  if (pending.length === 0) return { scanned: 0, notifications: 0, samples: [] };

  // ¿Cuáles de esas series ya tienen edición AR disponible (mapeada, volumes>0)?
  const ids = [...new Set(pending.map((p) => p.anilistId))];
  const avail = await prisma.publisherEdition.findMany({
    where: { anilistId: { in: ids }, volumes: { gt: 0 } },
    select: { anilistId: true },
    distinct: ["anilistId"],
  });
  const availSet = new Set(avail.map((a) => a.anilistId as number));
  const ready = pending.filter((p) => availSet.has(p.anilistId));
  if (ready.length === 0) return { scanned: pending.length, notifications: 0, samples: [] };

  // Filtro por preferencia de "deseados".
  const users = [...new Set(ready.map((r) => r.userId))];
  const enabled = new Set(await filterNotifEnabled(users, "WISHLIST_AVAILABLE"));

  const samples: string[] = [];
  const pushByUser = new Map<string, string[]>(); // userId → títulos
  let notifications = 0;

  for (const it of ready) {
    if (!dryRun)
      // Marcamos avisado SIEMPRE (aunque la pref esté off): no re-evaluar.
      await prisma.wishlistItem.update({
        where: { id: it.id },
        data: { notifiedAvailable: true },
      });
    if (!enabled.has(it.userId)) continue;
    notifications++;
    if (samples.length < 20) samples.push(`${it.title} → ${it.userId}`);
    if (!dryRun) {
      await prisma.notification.create({
        data: {
          userId: it.userId,
          type: "WISHLIST_AVAILABLE",
          actorName: it.title,
          anilistId: it.anilistId,
          text: "🆕 Salió en Argentina (de tus deseados)",
        },
      });
      const arr = pushByUser.get(it.userId) ?? [];
      arr.push(it.title);
      pushByUser.set(it.userId, arr);
    }
  }

  if (!dryRun) {
    for (const [userId, titles] of pushByUser) {
      await sendPushToUsers([userId], {
        title: "🆕 Salió en Argentina",
        body:
          titles.length === 1
            ? `${titles[0]} (de tus deseados) ya tiene edición argentina`
            : `${titles.length} de tus deseados salieron en Argentina · ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? "…" : ""}`,
        url: titles.length === 1 ? `/deseados` : `/notificaciones`,
      });
    }
  }

  return { scanned: pending.length, notifications, samples };
}
