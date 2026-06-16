/**
 * Prueba los flujos de notificación contra TU cuenta, sin esperar el crawl real:
 *   A) Tomos nuevos (agrupado): simula tomo nuevo en 2-3 series que coleccionás
 *      → debería llegarte UN solo push agrupado.
 *   B) "Salió en Argentina": simula que una serie de tus DESEADOS quedó
 *      disponible → push "🆕 Salió en Argentina".
 *
 *   npx tsx scripts/test-notifications.ts <tu-email>
 *
 * Para revertir: npx tsx scripts/reset-notifications.ts <tu-email>
 * Necesitás push activado para ver el push (si no, solo la noti in-app).
 */
import { prisma } from "../lib/prisma";
import {
  detectAndNotifyNewVolumes,
  detectAndNotifyWishlistAvailable,
} from "../lib/catalogNotify";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: npx tsx scripts/test-notifications.ts <tu-email>");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });
  if (!user) {
    console.error(`No existe usuario con email ${email}`);
    process.exit(1);
  }
  console.log(`Usuario: ${user.name} (${user.id})`);
  const subs = await prisma.pushSubscription.count({ where: { userId: user.id } });
  console.log(
    `Push subscriptions: ${subs}${subs ? "" : " — ⚠ sin push, solo verás la noti in-app"}`,
  );

  // === A) Tomos nuevos (agrupado) ===
  const tracked = await prisma.trackedEdition.findMany({
    where: { manga: { userId: user.id } },
    select: { manga: { select: { anilistId: true } } },
  });
  const ids = [...new Set(tracked.map((t) => t.manga.anilistId))];
  // volumes>1 para que notifiedVolumes=volumes-1 sea ≥1 (si fuese 0, baseline silencioso).
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId: { in: ids }, volumes: { gt: 1 } },
    select: { id: true, title: true, volumes: true },
    take: 3,
  });
  console.log(`\n[A] Tomos nuevos — simulando en ${eds.length} edición(es) que coleccionás:`);
  for (const e of eds) {
    await prisma.publisherEdition.update({
      where: { id: e.id },
      data: { notifiedVolumes: e.volumes - 1 },
    });
    console.log(`  - "${e.title}" (vol ${e.volumes}, notified ${e.volumes - 1})`);
  }
  if (eds.length === 0) console.log("  (no encontré series tuyas con >1 tomo)");
  const nv = await detectAndNotifyNewVolumes(false);
  console.log(
    `  → ${nv.notifications} noti(s). ${eds.length > 1 ? "Debería llegarte 1 PUSH agrupado." : "1 push."}`,
  );

  // === B) Deseados que YA están disponibles (no preventa) → "🆕 Salió en AR" ===
  const wishes = await prisma.wishlistItem.findMany({
    where: { userId: user.id },
    select: { id: true, anilistId: true, title: true },
  });
  const wishAvail = new Set(
    (
      await prisma.publisherEdition.findMany({
        where: { anilistId: { in: wishes.map((w) => w.anilistId) }, volumes: { gt: 0 } },
        select: { anilistId: true },
        distinct: ["anilistId"],
      })
    ).map((a) => a.anilistId as number),
  );
  const cand = wishes.find((w) => wishAvail.has(w.anilistId));
  if (cand) {
    await prisma.wishlistItem.update({
      where: { id: cand.id },
      data: { notifiedAvailable: false },
    });
    console.log(`\n[B] Salió en AR — simulando para tu deseada "${cand.title}":`);
    const w = await detectAndNotifyWishlistAvailable(false);
    console.log(`  → ${w.notifications} noti(s). Debería llegarte "🆕 Salió en Argentina".`);
  } else {
    console.log(`\n[B] No tenés deseados YA disponibles (no preventa) para testear.`);
  }

  // === C) Deseado en PREVENTA que se lanza → "🎉 ¡Ya salió!" (camino de tomos) ===
  const preventaEd = await prisma.publisherEdition.findFirst({
    where: {
      work: { upcoming: true, editions: { some: {} } },
      anilistId: { in: wishes.map((w) => w.anilistId) },
    },
    select: { id: true, anilistId: true, title: true },
  });
  if (preventaEd) {
    // Simular el lanzamiento: 0 tomos → 1, sin re-baselinear (upcoming sigue true).
    await prisma.publisherEdition.update({
      where: { id: preventaEd.id },
      data: { volumes: 1, notifiedVolumes: 0 },
    });
    console.log(`\n[C] Lanzamiento de preventa deseada "${preventaEd.title}" (0→1 tomo):`);
    const nv2 = await detectAndNotifyNewVolumes(false);
    console.log(`  → ${nv2.notifications} noti(s). Debería llegarte "🎉 ¡Ya salió!".`);
    console.log(
      `  (restaurá la preventa con: npx tsx scripts/reset-preventa.ts ${preventaEd.anilistId})`,
    );
  } else {
    console.log(`\n[C] No tenés deseados en preventa para testear el "¡Ya salió!".`);
  }

  console.log(
    `\nListo. Revisá /notificaciones y tu celu. Revertir: npx tsx scripts/reset-notifications.ts ${email}`,
  );
  await prisma.$disconnect();
}

main();
