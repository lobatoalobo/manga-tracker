/**
 * Test end-to-end de notifyIvreaReleases en STAGING: arma un usuario+colección,
 * inserta salidas con fecha HOY (próximo tomo + reedición de un tomo que falta +
 * reedición de uno que ya tiene) y verifica a quién se le notifica.
 *
 *   node scripts/with-staging.mjs npx tsx scripts/test-ivrea-notify.ts
 */
import { prisma } from "../lib/prisma";
import { notifyIvreaReleases } from "../lib/localNotify";

async function main() {
  const ed = await prisma.publisherEdition.findFirst({
    where: { publisher: "Ivrea Argentina", workId: { not: null } },
    select: { id: true, workId: true, work: { select: { title: true } } },
  });
  if (!ed?.workId) return console.log("No hay edición de Ivrea con work.");
  const workId = ed.workId;
  const pseudoId = -workId;
  const title = ed.work?.title ?? "Test";
  console.log(`Serie de prueba: "${title}" (workId ${workId})`);

  const user = await prisma.user.upsert({
    where: { email: "notif-test@example.com" },
    update: {},
    create: { email: "notif-test@example.com", name: "Notif Test" },
  });
  const manga = await prisma.manga.upsert({
    where: { userId_anilistId: { userId: user.id, anilistId: pseudoId } },
    update: {},
    create: { userId: user.id, anilistId: pseudoId, romajiTitle: title, coverImage: "" },
  });
  const te = await prisma.trackedEdition.upsert({
    where: { mangaId_key: { mangaId: manga.id, key: "ivrea" } },
    update: { totalVolumes: 10 },
    create: { mangaId: manga.id, key: "ivrea", label: "Ivrea Argentina", publisher: "Ivrea Argentina", totalVolumes: 10 },
  });
  for (const v of [1, 2, 3])
    await prisma.ownedVolume.upsert({
      where: { editionId_volume: { editionId: te.id, volume: v } },
      update: {},
      create: { editionId: te.id, volume: v },
    });
  console.log("Colección: tiene tomos 1,2,3 (le falta 5).");

  const today = new Date(new Date().toISOString().slice(0, 10));
  await prisma.ivreaRelease.deleteMany({ where: { editionId: ed.id, releaseDate: today } });
  await prisma.ivreaReleaseNotified.deleteMany({ where: { key: { contains: `:${workId}:` } } });
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.ivreaRelease.createMany({
    data: [
      { slug: "test", title, volume: 11, kind: "volume", releaseDate: today, editionId: ed.id },
      { slug: "test", title, volume: 5, kind: "reissue", releaseDate: today, editionId: ed.id },
      { slug: "test", title, volume: 3, kind: "reissue", releaseDate: today, editionId: ed.id },
    ],
  });
  console.log("Salidas HOY: tomo 11 (próximo), reedición #5 (le falta), reedición #3 (ya lo tiene).");

  const res = await notifyIvreaReleases(false);
  const notifs = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { id: "asc" },
    select: { type: true, text: true, anilistId: true },
  });
  console.log("\nresult:", res);
  console.log("notis del usuario:", JSON.stringify(notifs, null, 1));
  console.log(
    `\nEsperado: 2 notis (📖 tomo 11 + ♻️ reedición 5). La reedición #3 NO debe notificar (ya lo tiene). anilistId debe ser ${pseudoId} (→ /serie/${workId}).`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
