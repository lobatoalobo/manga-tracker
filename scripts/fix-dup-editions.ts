/**
 * Limpia ediciones redundantes VACÍAS en los works target tras las fusiones
 * (fase 2). Usa `emptyDuplicateEditions` (pura, conservadora: borra la vacía solo
 * si hay hermana CON tomos del mismo conteo o slug colapsado; nunca borra si ambas
 * tienen datos). Dry-run por default; `--execute` aplica.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/fix-dup-editions.ts            # dry-run
 *   node scripts/with-prod.mjs npx tsx scripts/fix-dup-editions.ts --execute  # aplica
 */
import { prisma } from "../lib/prisma";
import { emptyDuplicateEditions, cleanRedundantEditionsForWork } from "../lib/mergeWorks";

const TARGETS = [2308, 185, 66, 257, 25, 120, 2364, 101, 316, 339, 155, 110, 324, 433];

async function main() {
  const execute = process.argv.includes("--execute");
  let totalDel = 0;
  const manual: string[] = [];

  for (const id of TARGETS) {
    const eds = await prisma.publisherEdition.findMany({
      where: { workId: id },
      select: { id: true, publisher: true, slug: true, volumes: true, _count: { select: { volumesList: true } } },
    });
    const byPub = new Map<string, { id: number; slug: string; volumes: number; vrows: number }[]>();
    for (const e of eds)
      (byPub.get(e.publisher) ?? byPub.set(e.publisher, []).get(e.publisher)!).push({
        id: e.id, slug: e.slug, volumes: e.volumes, vrows: e._count.volumesList,
      });

    const toDel = [...byPub.values()].flatMap((g) => emptyDuplicateEditions(g));
    // 2º pase: grupos de la MISMA editorial donde TODAS están vacías y con el mismo
    // conteo (las "doble VIZ": sin datos, son la misma edición duplicada). Conserva
    // el slug más corto, borra el resto. Sin riesgo (cero tomos en cualquiera).
    const extra: { id: number; slug: string }[] = [];
    for (const [pub, g] of byPub) {
      if (g.length < 2 || toDel.some((d) => g.find((e) => e.id === d.id))) continue;
      const vols = new Set(g.map((e) => e.volumes));
      if (g.every((e) => e.vrows === 0) && vols.size === 1) {
        const keep = [...g].sort((a, b) => a.slug.length - b.slug.length)[0];
        for (const e of g) if (e.id !== keep.id) extra.push({ id: e.id, slug: e.slug });
      } else {
        manual.push(`#${id} ${pub}: ${g.map((e) => `${e.slug}(${e.vrows}t)`).join(" / ")}`);
      }
    }

    const all = [...toDel.map((e) => ({ id: e.id, slug: e.slug })), ...extra];
    if (all.length) {
      console.log(`#${id}: borrar ${all.map((e) => e.slug).join(", ")}`);
      totalDel += all.length;
    }
    if (execute) {
      await cleanRedundantEditionsForWork(id);
      for (const e of extra) await prisma.publisherEdition.delete({ where: { id: e.id } }).catch(() => {});
    }
  }

  if (manual.length) {
    console.log("\n⚠ A REVISAR A MANO (2 ediciones, ambas con tomos):");
    for (const m of manual) console.log("   " + m);
  }
  console.log(`\n${execute ? "APLICADO" : "DRY-RUN"} · ${totalDel} edición(es) vacía(s) a borrar${execute ? "" : " (usá --execute)"}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
