/**
 * Reconcilia el chip "🔜 Próximo a salir" usando la página de próximas salidas
 * de Ivrea como fuente de verdad. Corre el mismo `reconcileIvreaProximas` que el
 * cron mensual de Vercel.
 *
 *   npx tsx scripts/ivrea-proximas.ts          # aplica
 *   npx tsx scripts/ivrea-proximas.ts --dry    # solo reporta, no escribe
 */
import { reconcileIvreaProximas } from "../lib/ivreaProximas";
import { prisma } from "../lib/prisma";

async function main() {
  const dry = process.argv.includes("--dry");
  const r = await reconcileIvreaProximas(dry);
  console.log(dry ? "[DRY RUN]" : "[APLICADO]");
  console.log(`  Tarjetas en /proximas/:     ${r.cards}`);
  console.log(`  Snapshot IvreaRelease:      ${r.snapshot} (mapeadas: ${r.mapped})`);
  console.log(`  Reediciones:                ${r.reissues}`);
  console.log(`  Próximas series (/news/):   ${r.newSeries} (sembradas: ${r.debutWorks})`);
  console.log(`  Chips viejos apagados:      ${r.clearedStale}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
