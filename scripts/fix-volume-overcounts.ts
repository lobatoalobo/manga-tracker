/**
 * Corrige el SOBRE-CONTEO de tomos de ediciones Ivrea: cuando el catálogo contó
 * tomos que Ivrea anuncia pero aún NO salieron (contradicción "📅 Próximo tomo #2"
 * con "3 tomos"). Usa el snapshot YA guardado en `IvreaRelease` (NO re-fetchea
 * Ivrea, así que es seguro de correr local aunque Ivrea tenga baneada la IP).
 *
 * Es la misma lógica que corre el cron de /proximas/ (`capOvercountedIvreaEditions`);
 * este script la dispara one-off contra prod/staging.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/fix-volume-overcounts.ts          # dry
 *   node scripts/with-prod.mjs npx tsx scripts/fix-volume-overcounts.ts --apply
 */
import { capOvercountedIvreaEditions } from "../lib/ivreaProximas";
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const changes = await capOvercountedIvreaEditions(!apply);
  if (changes.length === 0) {
    console.log("Sin sobre-conteos: todas las ediciones con tomo futuro ya están capadas.");
  } else {
    console.log(`${apply ? "CORREGIDAS" : "DRY — a corregir"}: ${changes.length} ediciones\n`);
    for (const c of changes)
      console.log(`  ${c.from} → ${c.to}  (Δ${c.to - c.from})  "${c.title}" (ed#${c.editionId})`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
