import { prisma } from "@/lib/prisma";
import { filterNotifEnabled } from "@/lib/notificationPrefs";
import { sendPushToUsers } from "@/lib/push";

const PUB_KEY: Record<string, string> = {
  "Ivrea Argentina": "ivrea",
  "Panini Argentina": "panini",
  "Ovni Press": "ovni",
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
        await sendPushToUsers(userIds, {
          title: releasing ? "🎉 ¡Ya salió!" : "📖 Tomo nuevo",
          body: `${r.title} — Tomo ${r.volumes} (${r.publisher})`,
          url: `/manga/${anilistId}`,
        });
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

  return {
    scanned: rows.length,
    changed: increased.length,
    notifications,
    samples,
  };
}
