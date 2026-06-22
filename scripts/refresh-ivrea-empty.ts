/**
 * Refresca las ediciones de Ivrea que quedaron con 0 tomos: re-lee la ficha y
 * actualiza el conteo (y el status). Si la serie ya salió (tomos > 0), la edición
 * pasa a tener sus tomos y la obra deja de estar "próxima". Si sigue en 0 con
 * fecha futura, queda como próxima. Para los limbos "EN CATÁLOGO con 0 tomos"
 * (ver serie/1597). Idempotente, dbRetry, fetch con timeout (ver lib/httpFetch).
 *
 *   node scripts/with-prod.mjs npx tsx scripts/refresh-ivrea-empty.ts [--dry]
 */
import { prisma } from "../lib/prisma";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";
import { dbRetry } from "../lib/dbRetry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dry = process.argv.includes("--dry");
  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: { publisher: "Ivrea Argentina", volumes: 0, workId: { not: null } },
      select: { id: true, slug: true, title: true, workId: true, work: { select: { upcoming: true } } },
    }),
  );
  console.log(`${eds.length} ediciones Ivrea con 0 tomos a revisar…\n`);

  let withTomos = 0;
  let stillEmpty = 0;
  let unreachable = 0;
  for (const e of eds) {
    const d = await getIvreaDataBySlug(e.slug).catch(() => null);
    if (!d) {
      unreachable++;
      console.log(`  ? ${e.title} — ficha no accesible`);
      await sleep(400);
      continue;
    }
    const vol = d.argentinaVolumes;
    if (vol > 0) {
      withTomos++;
      console.log(`  ✓ ${e.title} → ${vol} tomos (${d.argentinaStatus})`);
      if (!dry) {
        await dbRetry(() =>
          prisma.publisherEdition.update({
            where: { id: e.id },
            data: { volumes: vol, status: d.argentinaStatus },
          }),
        ).catch(() => {});
        // Ya salió: la obra no es "próxima". (El lock `upcoming` curado lo respeta
        // el sync de próximas; acá una salida real lo apaga.)
        if (e.work?.upcoming)
          await dbRetry(() =>
            prisma.work.update({ where: { id: e.workId! }, data: { upcoming: false } }),
          ).catch(() => {});
      }
    } else {
      stillEmpty++;
      console.log(`  · ${e.title} — sigue en 0 tomos (${d.argentinaStatus})`);
    }
    await sleep(400);
  }

  console.log(
    `\n${dry ? "[DRY] " : ""}con tomos ${withTomos} · sigue vacía ${stillEmpty} · ficha caída ${unreachable}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
