/**
 * Backfill de la identidad de obra (Work) para las ediciones ya existentes.
 * Crea/asocia una Work por edición: agrupando por anilistId cuando existe, y por
 * título normalizado cuando no. Procesa primero las mapeadas a AniList para que
 * las no mapeadas reusen la misma obra si comparten título.
 *
 *   npx tsx scripts/backfill-works.ts
 *
 * Corre contra DATABASE_URL (.env). Es additivo e idempotente: solo toca filas
 * con workId null y reusa Works existentes.
 */
import { prisma } from "../lib/prisma";
import { findOrCreateWork } from "../lib/catalog";

async function main() {
  const rows = await prisma.publisherEdition.findMany({
    where: { workId: null },
    select: { id: true, title: true, anilistId: true },
    // Mapeadas a AniList primero (nulls al final).
    orderBy: { anilistId: { sort: "asc", nulls: "last" } },
  });
  console.log(`Ediciones sin workId: ${rows.length}`);

  let done = 0;
  for (const r of rows) {
    const workId = await findOrCreateWork({
      title: r.title,
      anilistId: r.anilistId,
    }).catch(() => null);
    if (workId)
      await prisma.publisherEdition
        .update({ where: { id: r.id }, data: { workId } })
        .catch(() => {});
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${rows.length}`);
  }

  const works = await prisma.work.count();
  console.log(`Listo: ${done} ediciones procesadas, ${works} works en total.`);
  await prisma.$disconnect();
}

main();
