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

// [source (se borra) , target (se conserva, el de anilistId)]
const MERGES: [number, number][] = [
  [2411, 2308], // Dead Dead Demon
  [938, 185], // Saintia Sho
  [967, 66], // Evangelion Iron Maiden
  [959, 257], // MHA Vigilantes (Illegals, Ivrea)
  [2387, 257], // MHA Vigilantes (VIZ)
  [981, 25], // Sailor Moon
  [982, 120], // Sailor Moon Short Stories
  [2390, 2364], // Kaiju Nº 8 (VIZ → Ivrea)
  [966, 101], // NGE Crianza de Shinji
  [1008, 316], // Record of Ragnarök
  [1009, 339], // Lü Bu Fengxian (spin-off)
  [1003, 155], // Sekaiichi Hatsukoi (confirmado por el usuario)
  [2576, 110], // Welcome to the NHK
  [2389, 324], // Spy x Family (VIZ → Ivrea)
  [799, 433], // Amor, devoraré tu corazón / Itoshii…
];

async function main() {
  const execute = process.argv.includes("--execute");

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
