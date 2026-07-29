/**
 * Dry-run de backfilleabilidad (F2 PR-1): mide, SIN escribir nada, qué proporción de `OwnedVolume` puede mapearse de
 * forma inequívoca al eje nuevo `PublisherEdition → Volume`. Reutiliza la correspondencia autoritativa de F1. Su
 * salida es la evidencia para el ADR de F2; el reporte MIDE, no decide. Read-only.
 *
 *   node scripts/with-staging.mjs npx tsx scripts/backfill-collection-dryrun.ts --confirm-target
 *   node scripts/with-prod.mjs    npx tsx scripts/backfill-collection-dryrun.ts --confirm-target
 *
 * Guard de destino (coherente con with-prod.mjs/with-staging.mjs): imprime host y base destino; corre sin flag SÓLO
 * contra la base efímera de tests; contra cualquier otra base exige `--confirm-target`. No imprime credenciales. No
 * escribe (ni directa ni indirectamente): sólo `findMany`.
 */
import { prisma } from "../lib/prisma";
import { legacyOwnershipSource } from "../lib/collection-read/adapters/legacy";
import { catalogUniverseSource } from "../lib/collection-read/adapters/catalog-universe";
import { accumulate, assertCardinality, emptyAggregate, formatReport, scanUser } from "../lib/collection-read/backfill-scan";

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

async function main() {
  const t = targetInfo();
  console.log(`Destino → host=${t.host} base=${t.database}`);
  if (!t.ephemeral && !process.argv.includes("--confirm-target")) {
    console.error(
      "\nAbortado: destino fuera de la base efímera de tests.\n" +
        "Este dry-run es SÓLO LECTURA. Para correrlo contra staging/producción reconocé el destino con --confirm-target.\n" +
        "Ej.: node scripts/with-staging.mjs npx tsx scripts/backfill-collection-dryrun.ts --confirm-target",
    );
    process.exit(2);
  }

  const startedAt = Date.now();
  const legacy = legacyOwnershipSource(prisma);
  const catalog = catalogUniverseSource(prisma);
  const agg = emptyAggregate();

  // Iteración PAGINADA por cursor sobre User (no carga la lista completa de usuarios). Los usuarios sin colección se
  // saltan (el adapter legado devuelve []). Orden determinista por id asc.
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
      accumulate(agg, scanUser(obs, uni.volumes, uni.editions));
    }
    cursor = page[page.length - 1].id;
    if (page.length < USER_PAGE) break;
  }

  assertCardinality(agg); // falla explícito si Σbuckets ≠ total
  console.log("\n" + formatReport(agg, Date.now() - startedAt));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
