/**
 * F2.2 — Executor de backfill legado → Collection (ADR-012). Migra SOLO los `OwnedVolume` clasificados como
 * RESOLVABLE (destino determinístico único), estableciendo presencia en Collection sin tocar catálogo ni legado.
 * Reutiliza EXACTAMENTE la clasificación del dry-run (`scanUser` + la correspondencia autoritativa de F1); los
 * otros cuatro buckets se cuentan y se OMITEN. Idempotente, resumible, reejecutable, solo-avance.
 *
 *   node scripts/with-staging.mjs npx tsx scripts/backfill-collection-run.ts --confirm-target
 *   node scripts/with-prod.mjs    npx tsx scripts/backfill-collection-run.ts --confirm-target
 *
 * Guard de destino idéntico al dry-run: imprime host y base (sin credenciales); corre sin flag SÓLO contra la base
 * efímera de tests; contra cualquier otra base exige `--confirm-target`. Sin PII en la salida.
 */
import { prisma } from "../lib/prisma";
import { legacyOwnershipSource } from "../lib/collection-read/adapters/legacy";
import { catalogUniverseSource } from "../lib/collection-read/adapters/catalog-universe";
import {
  accumulate,
  assertCardinality,
  BACKFILL_BUCKETS,
  bucketSum,
  emptyAggregate,
  scanUser,
} from "../lib/collection-read/backfill-scan";
import { buildCorrespondenceIndex, resolveCorrespondence } from "../lib/collection-read/mapping/correspondence";
import { buildLegacyBackfillFact, establishLegacyPresence, type BackfillResult } from "../lib/collection-context/backfill";

const USER_PAGE = 500;

/** Extrae host y base de `DATABASE_URL` SIN exponer credenciales. Marca si es la base efímera de tests. */
function targetInfo(): { host: string; database: string; ephemeral: boolean } {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const u = new URL(raw);
    const host = `${u.hostname}:${u.port || "5432"}`;
    const database = u.pathname.replace(/^\//, "") || "(default)";
    const ephemeral = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && database === "identity_test";
    return { host, database, ephemeral };
  } catch {
    return { host: "(desconocido)", database: "(desconocido)", ephemeral: false };
  }
}

type Tally = Record<BackfillResult, number>;
const emptyTally = (): Tally => ({ APPLIED: 0, ALREADY_APPLIED: 0, ALREADY_PRESENT: 0, CONFLICT: 0, TERMINAL: 0, RETRYABLE: 0 });

async function main() {
  const t = targetInfo();
  console.log(`Destino → host=${t.host} base=${t.database}`);
  if (!t.ephemeral && !process.argv.includes("--confirm-target")) {
    console.error(
      "\nAbortado: destino fuera de la base efímera de tests.\n" +
        "El executor ESCRIBE OwnershipPosition/Acquisition (solo RESOLVABLE). Reconocé el destino con --confirm-target.\n" +
        "Ej.: node scripts/with-staging.mjs npx tsx scripts/backfill-collection-run.ts --confirm-target",
    );
    process.exit(2);
  }

  const startedAt = Date.now();
  const legacy = legacyOwnershipSource(prisma);
  const catalog = catalogUniverseSource(prisma);
  const agg = emptyAggregate(); // conteo de los 5 buckets (misma clasificación que el dry-run)
  const tally = emptyTally(); // resultado de escritura por RESOLVABLE
  let resolvableProcessed = 0;

  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.user.findMany({
      take: USER_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (page.length === 0) break;
    for (const { id } of page) {
      const obs = await legacy.observe(id);
      if (obs.length === 0) continue;
      const anilistIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a > 0))];
      const workIds = [...new Set(obs.map((o) => o.anilistId).filter((a) => a < 0).map((a) => -a))];
      const uni = await catalog.forAnchors(anilistIds, workIds);

      // (a) Clasificación de los 5 buckets — MISMA función que el dry-run.
      accumulate(agg, scanUser(obs, uni.volumes, uni.editions));

      // (b) Destinos RESOLVABLE — MISMO substrato (resolveCorrespondence.matched). Se verifica coherencia abajo.
      const matched = resolveCorrespondence(buildCorrespondenceIndex(uni.volumes, obs)).matched;
      for (const m of matched) {
        const res = await establishLegacyPresence(buildLegacyBackfillFact(id, m.volumeId), prisma);
        tally[res]++;
        resolvableProcessed++;
      }
    }
    cursor = page[page.length - 1].id;
    if (page.length < USER_PAGE) break;
  }

  assertCardinality(agg); // Σ buckets == total (falla explícito si no)
  if (resolvableProcessed !== agg.counts.RESOLVABLE) {
    throw new Error(`Incoherencia: RESOLVABLE contados=${agg.counts.RESOLVABLE} ≠ procesados=${resolvableProcessed}`);
  }

  const sum = bucketSum(agg);
  const lines: string[] = [];
  lines.push("=== Backfill legado → Collection (F2.2) ===");
  lines.push(`OwnedVolume observados: ${agg.total}`);
  lines.push(`Usuarios afectados: ${agg.affectedUsers}  (con ≥1 no-resoluble: ${agg.usersWithUnresolvable})`);
  lines.push("");
  lines.push("Buckets (clasificación; solo RESOLVABLE se escribe):");
  for (const b of BACKFILL_BUCKETS) lines.push(`  ${b.padEnd(20)} ${String(agg.counts[b]).padStart(9)}`);
  lines.push(`  ${"Σ".padEnd(20)} ${String(sum).padStart(9)}   (== total: ${sum === agg.total})`);
  lines.push("");
  lines.push("Resultado de escritura (sobre RESOLVABLE):");
  lines.push(`  RESOLVABLE aplicados (APPLIED)   ${String(tally.APPLIED).padStart(9)}`);
  lines.push(`  ya aplicados (ALREADY_APPLIED)   ${String(tally.ALREADY_APPLIED).padStart(9)}`);
  lines.push(`  ya presentes (ALREADY_PRESENT)   ${String(tally.ALREADY_PRESENT).padStart(9)}`);
  lines.push(`  conflictos (CONFLICT)            ${String(tally.CONFLICT).padStart(9)}`);
  lines.push(`  terminales (TERMINAL)            ${String(tally.TERMINAL).padStart(9)}`);
  lines.push(`  reintentables (RETRYABLE)        ${String(tally.RETRYABLE).padStart(9)}`);
  lines.push(`  Σ resultados                     ${String(resolvableProcessed).padStart(9)}   (== RESOLVABLE: ${resolvableProcessed === agg.counts.RESOLVABLE})`);
  lines.push("");
  lines.push(`Duración: ${Date.now() - startedAt} ms`);
  console.log("\n" + lines.join("\n"));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
