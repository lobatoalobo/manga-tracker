/**
 * Auditoría/reparación del drift entre el ledger `Acquisition` (fuente de verdad) y `OwnershipPosition.quantity`
 * (Collection, Slice 8). Fuera del camino del usuario. Read-only por defecto; repara solo con `--repair`.
 * Idempotente. Corrección ante concurrencia: por cada par, dentro de UNA transacción, el orden es
 * **lock → sum → update** (SELECT FOR UPDATE de la posición → recomputar Σ Acquisition → fijar quantity=Σ). Ese
 * orden es parte de la corrección: nunca escribe una suma calculada afuera ni pierde una adquisición que entra
 * entre el cálculo y la escritura. Explicación completa en lib/collection-context/audit.ts.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/audit-ownership.ts            # dry (solo reporta)
 *   node scripts/with-prod.mjs npx tsx scripts/audit-ownership.ts --repair   # alinea cada posición a Σ Acquisition
 */
import { prisma } from "../lib/prisma";
import { auditOwnership } from "../lib/collection-context/audit";

async function main() {
  const repair = process.argv.includes("--repair");
  const { drifts, repaired } = await auditOwnership(prisma, { repair });

  if (drifts.length === 0) {
    console.log("Colección consistente: sin drift entre Acquisition y OwnershipPosition.");
  } else {
    console.log(`${repair ? "REPARADAS" : "DRY — drift detectado"}: ${drifts.length} posiciones\n`);
    for (const d of drifts)
      console.log(`  [${d.kind}] user=${d.userId} vol=${d.volumeId}  posición=${d.positionQuantity ?? "—"}  Σadquisiciones=${d.acquisitionsSum}`);
    console.log(
      repair
        ? `\nReparadas ${repaired} posiciones (cada una recomputada a Σ Acquisition dentro de su transacción con lock).`
        : `\nCorré con --repair para alinear cada posición a Σ Acquisition. Política ORPHAN_NONZERO: se lleva a 0, NO se borra la fila.`,
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
