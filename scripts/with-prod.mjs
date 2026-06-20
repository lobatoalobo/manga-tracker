// Corre un comando con TODO el .env cargado (DATABASE_URL = PROD, sin override).
// Análogo a with-staging.mjs pero apuntando a producción. Para correr crawls/
// pipelines contra prod desde local (ej. el poblado inicial de VIZ).
//
//   node scripts/with-prod.mjs npx tsx scripts/crawl.ts viz
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
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = loadEnv();
if (!/^postgres(ql)?:\/\//.test(fileEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? "")) {
  console.error("Falta DATABASE_URL (prod) en .env");
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: node scripts/with-prod.mjs <comando…>");
  process.exit(1);
}
console.log("→ Ejecutando contra PROD:", args.join(" "));
const res = spawnSync(args[0], args.slice(1), {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ...fileEnv },
});
process.exit(res.status ?? 1);
