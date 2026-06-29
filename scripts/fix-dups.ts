/**
 * Fusiona works partidos (confirmados a mano sobre el diagnóstico de inspect-dups).
 * Dry-run por default (muestra qué mueve/borra cada uno); `--execute` aplica.
 * Usa el `mergeWorks` battle-tested (source se borra, target se conserva). Las
 * parejas tienen ids externos distintos a propósito → no pasa por el guard del
 * framework (las confirmó el humano).
 *
 *   node scripts/with-prod.mjs npx tsx scripts/fix-dups.ts            # dry-run
 *   node scripts/with-prod.mjs npx tsx scripts/fix-dups.ts --execute  # aplica
 */
import { prisma } from "../lib/prisma";
import { mergeWorks } from "../lib/mergeWorks";

// Parejas source→target por argv: "src:tgt" (source se borra, target se conserva,
// el de anilistId). Ej: npx tsx scripts/fix-dups.ts 2599:236 2607:1716 --execute
async function main() {
  const execute = process.argv.includes("--execute");
  const MERGES: [number, number][] = process.argv
    .slice(2)
    .filter((a) => a.includes(":"))
    .map((a) => a.split(":").map(Number) as [number, number]);
  if (!MERGES.length) {
    console.error("uso: fix-dups <src:tgt…> [--execute]");
    process.exit(1);
  }

  for (const [src, tgt] of MERGES) {
    const [s, t] = await Promise.all([
      prisma.work.findUnique({
        where: { id: src },
        select: { id: true, title: true, editions: { select: { publisher: true, slug: true, volumes: true } } },
      }),
      prisma.work.findUnique({ where: { id: tgt }, select: { id: true, title: true } }),
    ]);
    if (!s || !t) {
      console.log(`✗ #${src}→#${tgt}: ${!s ? `source ${src}` : `target ${tgt}`} no existe (¿ya fusionado?)`);
      continue;
    }
    const edStr = s.editions.map((e) => `${e.publisher} ${e.volumes}t`).join(", ");
    if (!execute) {
      console.log(`MERGE #${src} «${s.title}» [${edStr}] → #${tgt} «${t.title}»`);
      continue;
    }
    try {
      const r = await mergeWorks(src, tgt);
      console.log(`✓ #${src} → #${tgt} «${t.title}» — ${r.editionsMoved} edición(es) movida(s)`);
    } catch (e) {
      console.log(`✗ #${src} → #${tgt}: ${(e as Error).message}`);
    }
  }

  console.log(execute ? "\nAPLICADO. Correr inspect-dups sobre los targets para la fase 2 (ediciones dup)." : "\nDRY-RUN — usá --execute para aplicar.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
