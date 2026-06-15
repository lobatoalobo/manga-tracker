/**
 * Prueba controlada del flow de preventa → lanzamiento, sin esperar el crawl real.
 *
 *   npx tsx scripts/test-preventa.ts [anilistId]   # default 180752 (Ichi the Witch)
 *
 * Hace, sobre la 1ª edición de esa serie:
 *   1) la deja como preventa: upcoming=true, tomos=0, notifiedVolumes=0.
 *   2) "simula el crawl": le sube el tomo a 1 (como hace upsert, SIN re-baselinear).
 *   3) corre detectAndNotifyNewVolumes (lo que corre el cron) y verifica que la
 *      serie se desmarcó (upcoming=false) y se generó la notificación.
 *
 * Es idempotente: el paso 1 resetea, así que podés re-correrlo. Corre contra
 * DATABASE_URL (.env). detectAndNotify procesa todo el catálogo (como el cron):
 * solo notifica donde hay aumento real, así que el ruido es mínimo.
 */
import { prisma } from "../lib/prisma";
import { detectAndNotifyNewVolumes } from "../lib/catalogNotify";

const anilistId = Number(process.argv[2]) || 180752;

async function show(label: string) {
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId },
    select: {
      id: true,
      title: true,
      volumes: true,
      notifiedVolumes: true,
      work: { select: { id: true, upcoming: true } },
    },
    orderBy: { id: "asc" },
  });
  console.log(`\n== ${label} ==`);
  for (const e of eds)
    console.log(
      `  #${e.id} "${e.title}" vol=${e.volumes} notified=${e.notifiedVolumes} upcoming=${e.work?.upcoming}`,
    );
  return eds;
}

async function main() {
  const before = await show("ANTES");
  if (before.length === 0) {
    console.log(`No hay ediciones mapeadas a anilistId ${anilistId}.`);
    await prisma.$disconnect();
    return;
  }
  const ed = before[0];

  // 1) Preventa: upcoming + 0 tomos + notifiedVolumes 0.
  if (ed.work)
    await prisma.work.update({
      where: { id: ed.work.id },
      data: { upcoming: true },
    });
  await prisma.publisherEdition.update({
    where: { id: ed.id },
    data: { volumes: 0, notifiedVolumes: 0 },
  });
  await show("1) Preventa seteada (0 tomos, upcoming)");

  // 2) "Crawl": sale el tomo 1 (sube vol a 1, notifiedVolumes queda en 0).
  await prisma.publisherEdition.update({
    where: { id: ed.id },
    data: { volumes: 1 },
  });
  await show("2) Crawl: sale el tomo 1 (vol=1, notified=0)");

  // 3) Detección (como el cron).
  const res = await detectAndNotifyNewVolumes(false);
  console.log(
    `\nDetección: ${res.changed} con cambio, ${res.notifications} notificación(es).`,
  );
  const sample = res.samples.find((s) => s.toLowerCase().includes(ed.title.toLowerCase().slice(0, 8)));
  if (sample) console.log(`  → ${sample}`);

  const after = await show("3) DESPUÉS de la detección");
  const upcoming = after[0]?.work?.upcoming;
  console.log(
    `\n>>> Resultado: upcoming = ${upcoming} ` +
      (upcoming === false ? "✅ (se desmarcó, el badge desaparece)" : "❌ (debería ser false)"),
  );

  await prisma.editionsCache.deleteMany({ where: { anilistId } });
  await prisma.$disconnect();
}

main();
