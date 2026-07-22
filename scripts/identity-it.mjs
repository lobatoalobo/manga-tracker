/**
 * Corre los tests de integración del slice de identidad contra un PostgreSQL EFÍMERO y AISLADO
 * (embedded-postgres: binario real, no un mock; nunca la base compartida). Levanta la instancia,
 * aplica TODAS las migraciones (`prisma migrate deploy`) sobre una base limpia y ejecuta solo
 * `tests/identity-confer.integration.test.ts`. Config mínima y reproducible para dev/CI:
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
  execSync("npx vitest run tests/identity-confer.integration.test.ts", {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, IDENTITY_TEST_DATABASE_URL: url },
  });
} catch (err) {
  failed = true;
  console.error("[identity-it] FAILED:", err?.message ?? err);
} finally {
  try { await pg.stop(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
