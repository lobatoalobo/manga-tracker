/**
 * Restaura una serie a estado de PREVENTA para volver a probar el flow.
 *
 *   npx tsx scripts/reset-preventa.ts [anilistId]   # default 180752 (Ichi the Witch)
 *
 * Deja: edición(es) en 0 tomos, notifiedVolumes=0, Work.upcoming=true, e invalida
 * la caché. También borra las notificaciones de prueba (NEW_VOLUME) de esa serie,
 * así la próxima corrida de test-preventa genera una notificación nueva limpia.
 */
import { prisma } from "../lib/prisma";

const anilistId = Number(process.argv[2]) || 180752;

async function main() {
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId },
    select: { id: true, workId: true, title: true },
  });
  if (eds.length === 0) {
    console.log(`No hay ediciones mapeadas a ${anilistId}.`);
    await prisma.$disconnect();
    return;
  }

  await prisma.publisherEdition.updateMany({
    where: { anilistId },
    data: { volumes: 0, notifiedVolumes: 0 },
  });
  const workIds = [
    ...new Set(eds.map((e) => e.workId).filter((x): x is number => x != null)),
  ];
  if (workIds.length)
    await prisma.work.updateMany({
      where: { id: { in: workIds } },
      data: { upcoming: true },
    });
  await prisma.editionsCache.deleteMany({ where: { anilistId } });
  const delNotis = await prisma.notification.deleteMany({
    where: { anilistId, type: "NEW_VOLUME" },
  });

  console.log(
    `Restaurada "${eds[0].title}" (${anilistId}) a preventa: ${eds.length} edición(es) en 0 tomos, upcoming=true.`,
  );
  console.log(`Notificaciones de prueba borradas: ${delNotis.count}.`);
  console.log("Listo. Podés correr: npx tsx scripts/test-preventa.ts");
  await prisma.$disconnect();
}

main();
