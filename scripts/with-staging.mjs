// Corre un comando con DATABASE_URL apuntando a la rama de staging de Neon
// (STAGING_DATABASE_URL de .env). Sirve para aplicar/probar migraciones en
// staging antes de tocar producción.
//
//   node scripts/with-staging.mjs npx prisma migrate deploy
//   npm run migrate:staging
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function loadEnv() {
  let text = "";
  try {
    text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i === -1 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    const val = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    out[key] = val;
  }
  return out;
}

const staging = loadEnv().STAGING_DATABASE_URL;
if (!staging) {
  console.error("Falta STAGING_DATABASE_URL en .env");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: node scripts/with-staging.mjs <comando…>");
  process.exit(1);
}

console.log("→ Ejecutando contra STAGING:", args.join(" "));
const res = spawnSync(args[0], args.slice(1), {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: staging },
});
process.exit(res.status ?? 1);
