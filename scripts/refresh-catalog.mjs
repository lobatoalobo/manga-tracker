// Orquestador del refresh COMPLETO del catálogo, para correr de forma
// programada (Whakoom bloquea a los runners de GitHub, así que esto vive en la
// PC del usuario via Task Scheduler — ver scripts/refresh-catalog.ps1).
//
// Corre, en orden y contra PROD (DATABASE_URL de .env):
//   1) crawl whakoom-all (Panini/Ovni/Kemuri/…)       -> notifica tomos nuevos
//   2) enrich-works (géneros/portada/sinopsis MU+MD)  -> de a lotes
//
// NOTA: Ivrea ya NO corre acá. Se desacopló a un cron de Vercel
// (/api/cron/ivrea-catalogo), porque Ivrea no bloquea el datacenter. Esta tarea
// local solo queda para Whakoom (que sí bloquea la nube) + enrich.
//
// Cada paso es independiente: si uno falla, se loguea y se sigue con el resto.
// Sale con código !=0 si algún paso falló, para que el scheduler lo marque.
//
//   node scripts/refresh-catalog.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  let text = "";
  try {
    text = readFileSync(join(root, ".env"), "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i === -1 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    out[key] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...process.env, ...loadEnv() };
if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? "")) {
  console.error("✗ Falta una DATABASE_URL válida en .env (prod). Abortando.");
  process.exit(1);
}

const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const steps = [
  // Ivrea desacoplado a Vercel (/api/cron/ivrea-catalogo). Acá solo Whakoom + enrich.
  { name: "Whakoom (todas)", args: ["scripts/crawl.ts", "whakoom-all"] },
  { name: "Enrich works", args: ["scripts/enrich-works.ts", "--limit", "300"] },
  // Completa la versión de sinopsis que falte (ES↔EN) traduciendo la otra, así
  // toda obra queda con las 2 tabs. NO-OP sin OPENAI/DEEPL/ANTHROPIC key.
  { name: "Traducir sinopsis", args: ["scripts/translate-synopses.ts", "--limit", "500"] },
];

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
console.log(`\n===== Refresh de catálogo · ${ts()} =====`);

let failed = 0;
for (const step of steps) {
  console.log(`\n----- ${step.name} · ${ts()} -----`);
  const res = spawnSync(process.execPath, [tsx, ...step.args], {
    cwd: root,
    stdio: "inherit",
    env,
  });
  if (res.status !== 0) {
    failed++;
    console.error(`✗ ${step.name} terminó con código ${res.status}.`);
  } else {
    console.log(`✓ ${step.name} OK.`);
  }
}

// Paso final: espejar PROD → STAGING (Neon branching). Así staging queda fresco
// DESPUÉS de actualizar prod (lo que el usuario pidió). Solo si hay credenciales
// de Neon en .env; si no, se saltea sin romper.
if (env.NEON_API_KEY && env.NEON_PROJECT_ID) {
  console.log(`\n----- Sync staging (mirror de prod) · ${ts()} -----`);
  const res = spawnSync(
    process.execPath,
    [join(root, "scripts", "sync-staging.mjs"), "--yes"],
    { cwd: root, stdio: "inherit", env },
  );
  if (res.status !== 0) {
    failed++;
    console.error(`✗ Sync staging terminó con código ${res.status}.`);
  } else {
    console.log("✓ Staging espejado desde prod.");
  }
}

console.log(
  `\n===== Fin · ${ts()} · ${failed === 0 ? "todo OK" : `${failed} fallo(s)`} =====`,
);
process.exit(failed ? 1 : 0);
