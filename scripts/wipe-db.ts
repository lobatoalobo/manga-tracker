/**
 * Wipe TOTAL de la base (reset): borra todas las filas de todas las tablas del
 * schema public (catálogo + cuentas + colecciones), excepto `_prisma_migrations`.
 * NO toca el schema. Para el rebuild limpio del catálogo (ver
 * docs/plan-catalogo-local.md).
 *
 * Corré contra STAGING vía: `node scripts/with-staging.mjs npx tsx scripts/wipe-db.ts --yes`
 * Sin `--yes` solo reporta (host + tablas). Imprime el host para que confirmes
 * que NO es prod antes de truncar.
 */
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--yes");
  const host =
    process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "(desconocido)";
  console.log(`DB host: ${host}`);

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  const tables = rows.map((r) => r.tablename);
  console.log(`${tables.length} tablas: ${tables.join(", ")}`);

  if (!apply) {
    console.log("\n[DRY] Pasá --yes para truncar TODO. (Confirmá que el host es staging.)");
    return;
  }

  const list = tables.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
  console.log("\n✅ Base vaciada (TRUNCATE … RESTART IDENTITY CASCADE).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
