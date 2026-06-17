/**
 * Corrige el conteo de tomos PUBLICADOS de las ediciones de Ivrea que se
 * importaron desde Whakoom (URL whakoom.com). Esos imports quedaron con conteos
 * viejos que a veces incluían tomos *upcoming* (ej. Super DB Heroes: 4 → 0). El
 * parser actual de Whakoom ya excluye los no-publicados, así que re-leer la
 * página da el publicado real. Solo toca `volumes` (+ rebaselina notifiedVolumes
 * para no disparar "tomo nuevo" por una corrección).
 *
 * Whakoom bloquea datacenter → corre LOCAL. Ver [[whakoom-blocked-vercel]].
 *
 *   npx tsx scripts/fix-whakoom-counts.ts --dry   # solo reporta
 *   npx tsx scripts/fix-whakoom-counts.ts         # aplica
 */
import { prisma } from "../lib/prisma";
import { getWhakoomEdition } from "../lib/providers/whakoom";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dry = process.argv.includes("--dry");
  const eds = await prisma.publisherEdition.findMany({
    where: { publisher: "Ivrea Argentina", url: { contains: "whakoom.com" } },
    select: { id: true, title: true, volumes: true, notifiedVolumes: true, url: true },
  });
  console.log(`${eds.length} ediciones de Ivrea con URL de Whakoom.\n`);

  let changed = 0, errors = 0;
  const diffs: string[] = [];
  for (const e of eds) {
    const ed = await getWhakoomEdition(e.url).catch(() => null);
    await sleep(600);
    if (!ed) { errors++; continue; }
    if (ed.volumes !== e.volumes) {
      changed++;
      diffs.push(`  ${e.volumes} → ${ed.volumes}  ${e.title}`);
      if (!dry)
        await prisma.publisherEdition.update({
          where: { id: e.id },
          data: { volumes: ed.volumes, notifiedVolumes: ed.volumes },
        });
    }
  }
  console.log(diffs.join("\n"));
  console.log(
    `\n${dry ? "[DRY] " : ""}Conteos distintos: ${changed} · errores de fetch: ${errors}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
