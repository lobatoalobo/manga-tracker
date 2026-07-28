/**
 * Corre los tests de integración del subsistema de identidad contra un PostgreSQL EFÍMERO y AISLADO
 * (embedded-postgres: binario real, no un mock; nunca la base compartida). Levanta la instancia,
 * aplica TODAS las migraciones (`prisma migrate deploy`) sobre una base limpia y ejecuta todos los
 * `tests/identity-*.integration.test.ts` (Conferir + Asociar + los que se sumen). Config mínima y
 * reproducible para dev/CI:
 *   node scripts/identity-it.mjs
 */
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".tmp-identity-pg");
const port = 55433;
const password = "postgres";
const url = `postgresql://postgres:${password}@localhost:${port}/identity_test`;

rmSync(dataDir, { recursive: true, force: true });
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password,
  port,
  persistent: false,
  // El cluster debe ser UTF8: hay migraciones con caracteres UTF-8 en comentarios (p. ej. →),
  // que fallan si el cluster hereda WIN1252 (locale Windows por defecto).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

let failed = false;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("identity_test");

  console.log("[identity-it] applying migrations…");
  execSync("npx prisma migrate deploy", { stdio: "inherit", cwd: root, env: { ...process.env, DATABASE_URL: url } });

  console.log("[identity-it] running integration suite…");
  // Lista explícita de suites de integración de identidad (vitest no expande globs en el arg).
  // `--no-file-parallelism`: comparten UNA base efímera y cada archivo limpia globalmente en
  // afterEach; correrlos en paralelo haría que una limpieza borre datos en vuelo de la otra.
  const suites = [
    "tests/identity-confer.integration.test.ts",
    "tests/identity-associate.integration.test.ts",
    "tests/identity-reference-integrity.integration.test.ts",
    "tests/catalog-absorb-work.integration.test.ts",
    "tests/identity-merge.integration.test.ts",
    "tests/store-commerce.integration.test.ts",
    "tests/retail-preorder.integration.test.ts",
    "tests/retail-orders.integration.test.ts",
    "tests/retail-fulfillment.integration.test.ts",
    "tests/retail-notifications.integration.test.ts",
    "tests/retail-payments.integration.test.ts",
    "tests/retail-handoff.integration.test.ts",
    "tests/collection-apply.integration.test.ts",
    "tests/collection-projection.integration.test.ts",
    "tests/collection-immediate.integration.test.ts",
    "tests/collection-sweep.integration.test.ts",
    "tests/collection-read-audit.integration.test.ts",
    "tests/collection-read-collection-adapter.integration.test.ts",
    "tests/collection-read-legacy-adapter.integration.test.ts",
    "tests/collection-read-equivalence.integration.test.ts",
    "tests/collection-read-share-stat.integration.test.ts",
  ];
  execSync(`npx vitest run --no-file-parallelism ${suites.join(" ")}`, {
    stdio: "inherit",
    cwd: root,
    // `DATABASE_URL` también apunta a la base efímera: los tests que usan el `prisma` global (p. ej. la equivalencia
    // llama a `getCollectionItems`, que usa `@/lib/prisma`) deben leer de la MISMA base que el client explícito.
    env: { ...process.env, IDENTITY_TEST_DATABASE_URL: url, DATABASE_URL: url },
  });
} catch (err) {
  failed = true;
  console.error("[identity-it] FAILED:", err?.message ?? err);
} finally {
  try { await pg.stop(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
