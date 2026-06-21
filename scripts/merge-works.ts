// Fusiona dos Works duplicados (misma serie, quedaron separados). El TARGET es el
// que se conserva (elegí el que tiene anilistId / mejor ficha); el SOURCE se borra
// tras mover sus ediciones y re-clavear la data de usuario.
//
//   node scripts/with-staging.mjs npx tsx scripts/merge-works.ts <sourceId> <targetId>
//   node scripts/with-prod.mjs    npx tsx scripts/merge-works.ts <sourceId> <targetId>
import { prisma } from "../lib/prisma";
import { mergeWorks } from "../lib/mergeWorks";

async function main() {
  const [sourceArg, targetArg] = process.argv.slice(2);
  const sourceId = Number(sourceArg);
  const targetId = Number(targetArg);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    console.error("Uso: merge-works.ts <sourceId> <targetId>  (target = el que se conserva)");
    process.exit(1);
  }

  const works = await prisma.work.findMany({
    where: { id: { in: [sourceId, targetId] } },
    select: {
      id: true, title: true, anilistId: true,
      editions: { select: { publisher: true, slug: true } },
    },
  });
  for (const w of works)
    console.log(
      `  #${w.id} "${w.title}" anilistId=${w.anilistId ?? "—"} · ${w.editions.map((e) => `${e.publisher}[${e.slug}]`).join(", ")}`,
    );

  console.log(`\nFusionando #${sourceId} → #${targetId} …`);
  const r = await mergeWorks(sourceId, targetId);
  console.log(`✓ Listo. Ediciones movidas: ${r.editionsMoved}. Work #${sourceId} borrado.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
