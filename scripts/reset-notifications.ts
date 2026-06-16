/**
 * Revierte lo que dejó test-notifications.ts:
 *   - re-baseliza notifiedVolumes (sin tomos nuevos pendientes),
 *   - marca las deseadas YA disponibles como avisadas (no re-disparan),
 *   - borra las notis in-app de tipo NEW_VOLUME / WISHLIST_AVAILABLE del usuario.
 *
 *   npx tsx scripts/reset-notifications.ts <tu-email>
 */
import { prisma } from "../lib/prisma";
import { baselineNotifiedVolumes } from "../lib/catalogNotify";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: npx tsx scripts/reset-notifications.ts <tu-email>");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    console.error(`No existe usuario con email ${email}`);
    process.exit(1);
  }

  const n = await baselineNotifiedVolumes();
  console.log(`notifiedVolumes re-baselizados: ${n} ediciones.`);

  const avail = await prisma.publisherEdition.findMany({
    where: { anilistId: { not: null }, volumes: { gt: 0 } },
    select: { anilistId: true },
    distinct: ["anilistId"],
  });
  const ids = avail.map((a) => a.anilistId as number).filter(Boolean);
  const r = await prisma.wishlistItem.updateMany({
    where: { anilistId: { in: ids }, notifiedAvailable: false },
    data: { notifiedAvailable: true },
  });
  console.log(`Deseadas disponibles marcadas como avisadas: ${r.count}.`);

  const del = await prisma.notification.deleteMany({
    where: { userId: user.id, type: { in: ["NEW_VOLUME", "WISHLIST_AVAILABLE"] } },
  });
  console.log(`Notis in-app borradas (del usuario): ${del.count}.`);

  console.log("\nListo, todo reseteado.");
  await prisma.$disconnect();
}

main();
