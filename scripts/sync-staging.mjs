// Sincroniza STAGING como espejo de PROD usando branching de Neon (copy-on-write,
// instantáneo, sin re-crawlear). Resetea la branch de staging al estado actual
// de prod, re-aplica las migraciones pendientes y anonimiza los datos personales.
//
//   node scripts/sync-staging.mjs            # dry: muestra qué branches usaría
//   node scripts/sync-staging.mjs --yes      # ejecuta el reset + migrate + scrub
//
// Requiere en .env: NEON_API_KEY, NEON_PROJECT_ID, STAGING_DATABASE_URL.
// Detecta la branch de prod (la Default) y la de staging (nombre con "stag",
// o NEON_STAGING_BRANCH_ID si la setés). El reset es una llamada HTTP a Neon
// (no una conexión directa a Postgres), así que no depende del endpoint directo.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const API = "https://console.neon.tech/api/v2";

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

const env = loadEnv();
const KEY = env.NEON_API_KEY || process.env.NEON_API_KEY;
const PROJECT = env.NEON_PROJECT_ID || process.env.NEON_PROJECT_ID;
const apply = process.argv.includes("--yes");

if (!KEY || !PROJECT) {
  console.error(
    "Falta NEON_API_KEY o NEON_PROJECT_ID en .env. (Neon → Account settings → API keys; project id en la URL del proyecto.)",
  );
  process.exit(1);
}

async function api(path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Neon ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function waitOps(ops) {
  for (const op of ops || []) {
    let status = op.status;
    for (let i = 0; i < 60 && status !== "finished" && status !== "failed"; i++) {
      await sleep(2000);
      const { operation } = await api(`/projects/${PROJECT}/operations/${op.id}`);
      status = operation.status;
    }
    if (status !== "finished") throw new Error(`operación ${op.action} quedó en ${status}`);
  }
}

function run(cmd, args) {
  console.log(`\n→ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (res.status !== 0) throw new Error(`falló: ${cmd} ${args.join(" ")}`);
}

async function main() {
  const { branches } = await api(`/projects/${PROJECT}/branches`);
  const prod = branches.find((b) => b.default);
  const staging =
    branches.find((b) => b.id === (env.NEON_STAGING_BRANCH_ID || "")) ||
    branches.find((b) => /stag/i.test(b.name));

  if (!prod) throw new Error("No encontré la branch Default (prod).");
  if (!staging)
    throw new Error(
      "No encontré la branch de staging (por nombre 'stag' ni NEON_STAGING_BRANCH_ID).",
    );

  console.log(`Prod    : ${prod.name} (${prod.id})`);
  console.log(`Staging : ${staging.name} (${staging.id})`);

  if (!apply) {
    console.log(
      "\n[DRY] Resetearía staging ← prod, luego migrate:staging + scrub. Corré con --yes para ejecutar.",
    );
    return;
  }

  console.log(`\nReseteando ${staging.name} al estado actual de ${prod.name}…`);
  const res = await api(
    `/projects/${PROJECT}/branches/${staging.id}/restore`,
    { method: "POST", body: JSON.stringify({ source_branch_id: prod.id }) },
  );
  await waitOps(res.operations);
  console.log("✓ Reset listo (staging = prod).");

  // Re-aplicar migraciones pendientes (staging suele ir adelante de prod) + scrub.
  run("node", ["scripts/with-staging.mjs", "npx", "prisma", "migrate", "deploy"]);
  run("node", ["scripts/with-staging.mjs", "npx", "tsx", "scripts/scrub-staging.ts"]);
  console.log("\n✓ Staging sincronizado desde prod (datos frescos + anonimizados).");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
