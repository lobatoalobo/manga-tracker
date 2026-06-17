import { prisma } from "@/lib/prisma";
import { filterNotifEnabled } from "@/lib/notificationPrefs";
import { sendPushToUsers } from "@/lib/push";

export interface IvreaNotifyResult {
  fired: number; // salidas (release rows) que dispararon hoy
  notifications: number; // notis in-app creadas
  samples: string[];
}

/**
 * Notifica las salidas de Ivrea cuyo DÍA es hoy, desde el snapshot `IvreaRelease`
 * (catálogo local, por `workId`):
 *  - próximo TOMO (kind volume/debut/oneshot) → a quienes coleccionan la serie.
 *  - REEDICIÓN (kind reissue) → solo a quienes les FALTA ese tomo.
 *
 * Push agrupado (1 por usuario). Idempotente vía `IvreaReleaseNotified` (el
 * snapshot se reemplaza en cada corrida). Respeta prefs por categoría y el
 * silenciado por serie. Pensado para correr a diario.
 */
export async function notifyIvreaReleases(
  dryRun = false,
): Promise<IvreaNotifyResult> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const releases = await prisma.ivreaRelease.findMany({
    where: {
      editionId: { not: null },
      volume: { not: null },
      releaseDate: { gte: today, lt: tomorrow },
    },
    select: { editionId: true, volume: true, kind: true, releaseDate: true, title: true },
  });
  if (!releases.length) return { fired: 0, notifications: 0, samples: [] };

  const edIds = [...new Set(releases.map((r) => r.editionId as number))];
  const eds = await prisma.publisherEdition.findMany({
    where: { id: { in: edIds } },
    select: { id: true, workId: true, publisher: true, work: { select: { title: true } } },
  });
  const edInfo = new Map(eds.map((e) => [e.id, e]));

  const notified = new Set(
    (await prisma.ivreaReleaseNotified.findMany({ select: { key: true } })).map((n) => n.key),
  );

  type Ev = { title: string; volume: number; publisher: string; workId: number; reissue: boolean };
  const pushByUser = new Map<string, Ev[]>();
  let fired = 0;
  let notifications = 0;
  const samples: string[] = [];

  for (const r of releases) {
    const ed = edInfo.get(r.editionId as number);
    const workId = ed?.workId;
    if (workId == null) continue;
    const volume = r.volume as number;
    const dateISO = (r.releaseDate as Date).toISOString().slice(0, 10);
    const key = `${r.kind}:${workId}:${volume}:${dateISO}`;
    if (notified.has(key)) continue;

    const pseudoId = -workId;
    const reissue = r.kind === "reissue";
    const tracked = await prisma.trackedEdition.findMany({
      where: { manga: { anilistId: pseudoId } },
      select: {
        manga: { select: { userId: true } },
        ownedVolumes: { where: { volume }, select: { id: true } },
      },
    });
    // Reedición: solo a quienes NO tienen ese tomo. Próximo tomo: a todos.
    const audience = [
      ...new Set(
        (reissue
          ? tracked.filter((t) => t.ownedVolumes.length === 0)
          : tracked
        ).map((t) => t.manga.userId),
      ),
    ];

    const type = reissue ? "REISSUE" : "NEW_VOLUME";
    const enabled = await filterNotifEnabled(audience, type);
    const muted = enabled.length
      ? new Set(
          (
            await prisma.seriesNotifMute.findMany({
              where: { anilistId: pseudoId, userId: { in: enabled } },
              select: { userId: true },
            })
          ).map((m) => m.userId),
        )
      : new Set<string>();
    const userIds = enabled.filter((u) => !muted.has(u));

    const seriesTitle = ed?.work?.title ?? r.title;
    fired++;
    notifications += userIds.length;
    if (userIds.length && samples.length < 20)
      samples.push(`${reissue ? "♻️" : "📖"} ${seriesTitle} #${volume} → ${userIds.length}`);

    if (!dryRun) {
      if (userIds.length) {
        await prisma.notification.createMany({
          data: userIds.map((userId) => ({
            userId,
            type,
            actorName: seriesTitle,
            anilistId: pseudoId,
            text: reissue
              ? `♻️ Reedición · Tomo ${volume} (${ed?.publisher})`
              : `📖 Salió · Tomo ${volume} (${ed?.publisher})`,
          })),
        });
        for (const userId of userIds) {
          const arr = pushByUser.get(userId) ?? [];
          arr.push({ title: seriesTitle, volume, publisher: ed?.publisher ?? "", workId, reissue });
          pushByUser.set(userId, arr);
        }
      }
      await prisma.ivreaReleaseNotified.create({ data: { key } }).catch(() => {});
    }
  }

  if (!dryRun)
    for (const [userId, evs] of pushByUser) {
      if (evs.length === 1) {
        const e = evs[0];
        await sendPushToUsers([userId], {
          title: e.reissue ? "♻️ Reedición" : "📖 Nuevo tomo",
          body: `${e.title} — Tomo ${e.volume} (${e.publisher})`,
          url: `/serie/${e.workId}`,
        });
      } else {
        const sample = evs.slice(0, 3).map((e) => e.title).join(", ");
        await sendPushToUsers([userId], {
          title: "📚 Novedades de tu colección",
          body: `${evs.length} novedades · ${sample}${evs.length > 3 ? "…" : ""}`,
          url: `/notificaciones`,
        });
      }
    }

  return { fired, notifications, samples };
}
