/**
 * Simula que salieron TOMOS NUEVOS de las series que coleccionás, para ver que
 * (a) se popule "te faltan / para comprar" y (b) llegue la alerta.
 *
 * Para cada edición que coleccionás: sube +1 el conteo del catálogo, inserta una
 * salida de HOY (IvreaRelease) y dispara la noti. Después sincroniza tu colección
 * con el catálogo (syncTrackedTotals) y muestra el "te faltan".
 *
 *   node scripts/with-staging.mjs npx tsx scripts/test-new-volumes.ts <email>
 */
import { prisma } from "../lib/prisma";
import { syncTrackedTotals } from "../lib/syncTracked";
import { notifyIvreaReleases } from "../lib/localNotify";
import { getShoppingCount } from "../lib/shopping";

async function main() {
  const email = process.argv[2];
  if (!email) return console.error("Uso: ... test-new-volumes.ts <email>");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return console.error("No existe ese usuario.");

  const before = await getShoppingCount(user.id);
  console.log(`Antes → te faltan ${before.tomos} tomos en ${before.series} series`);

  const mangas = await prisma.manga.findMany({
    where: { userId: user.id, anilistId: { lt: 0 } },
    select: { anilistId: true, romajiTitle: true, editions: { select: { publisher: true } } },
  });

  const today = new Date(new Date().toISOString().slice(0, 10));
  let bumped = 0;
  for (const m of mangas) {
    const workId = -m.anilistId;
    for (const te of m.editions) {
      if (!te.publisher) continue;
      const ed = await prisma.publisherEdition.findFirst({
        where: { workId, publisher: te.publisher },
        select: { id: true, volumes: true, slug: true },
      });
      if (!ed) continue;
      const newVol = ed.volumes + 1;
      await prisma.publisherEdition.update({
        where: { id: ed.id },
        data: { volumes: newVol },
      });
      await prisma.ivreaReleaseNotified.deleteMany({ where: { key: { contains: `:${workId}:` } } });
      await prisma.ivreaRelease.create({
        data: {
          slug: ed.slug,
          title: m.romajiTitle,
          volume: newVol,
          kind: "volume",
          releaseDate: today,
          editionId: ed.id,
        },
      });
      bumped++;
      console.log(`  +1 → ${m.romajiTitle} (${te.publisher}): tomo ${newVol}`);
    }
  }

  const synced = await syncTrackedTotals();
  const notify = await notifyIvreaReleases();
  const after = await getShoppingCount(user.id);

  console.log(`\nEdiciones bumpeadas: ${bumped} · colección sincronizada: ${synced}`);
  console.log(`Notis disparadas: ${notify.notifications}`);
  console.log(`Después → te faltan ${after.tomos} tomos en ${after.series} series`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
