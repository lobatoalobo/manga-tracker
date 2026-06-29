/**
 * Corrige `originalTitle` (romaji) mal cargados que colisionaban con OTRA serie
 * (bug de enrich que copió el romaji equivocado). Cada uno se confirmó por
 * mismatch título-vs-romaji en inspect-dups. Dry-run por default; `--execute`.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/fix-original-titles.ts            # dry
 *   node scripts/with-prod.mjs npx tsx scripts/fix-original-titles.ts --execute
 */
import { prisma } from "../lib/prisma";

const FIXES: [number, string][] = [
  [283, "Darling in the FranXX"], // tenía DANGANRONPA THE ANIMATION
  [42, "Saber Marionette J"], // tenía LOST+BRAIN
  [98, "Hatsukoi Limited"], // tenía HAIKYU!!
  [2564, "Yu-Gi-Oh! Arc-V"], // tenía Yu-Gi-Oh (genérico → colisión con #20)
  [133, "Shaman King Flowers"], // tenía SHAMAN KING ZERO
];

async function main() {
  const execute = process.argv.includes("--execute");
  for (const [id, romaji] of FIXES) {
    const w = await prisma.work.findUnique({ where: { id }, select: { title: true, originalTitle: true } });
    if (!w) {
      console.log(`✗ #${id}: no existe`);
      continue;
    }
    console.log(`#${id} «${w.title}»: "${w.originalTitle}" → "${romaji}"`);
    if (execute) await prisma.work.update({ where: { id }, data: { originalTitle: romaji } });
  }
  console.log(execute ? "\nAPLICADO." : "\nDRY-RUN — usá --execute.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
