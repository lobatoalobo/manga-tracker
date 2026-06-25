/**
 * AUDITORÍA (read-only) de TOMOS por serie: compara el conteo de tomos de cada
 * edición Ivrea en Whakoom contra el nuestro, para ver si "realmente tenemos lo
 * mismo". Reusa la enumeración de `whakoom-ivrea-diff` + el match colapsado.
 *
 * Whakoom bloquea datacenter y puede banear la IP por over-fetching (igual que
 * Ivrea) → corre LOCAL, throttleado y **RESUMIBLE**: cachea cada ficha en
 * `scripts/.whakoom-ivrea-vols.json`; si Whakoom corta a mitad, volvés a correr
 * y retoma donde quedó. La comparación se imprime con lo que haya en cache.
 *
 * OJO: Whakoom NO es fuente de verdad de "publicados" (a veces lista tomos
 * anunciados). Las diferencias son "a revisar", no "Whakoom tiene razón".
 *
 *   node scripts/with-prod.mjs npx tsx scripts/whakoom-ivrea-volumes.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { enumeratePublisherEditions } from "../lib/whakoomImport";
import { getWhakoomEdition } from "../lib/providers/whakoom";
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { normalizeTitle } from "../lib/catalog";

const ALL_URL = "https://www.whakoom.com/publisher/27123/ivrea_argentina/all";
const URLS_CACHE = join(process.cwd(), "scripts", ".whakoom-ivrea-urls.json");
const VOLS_CACHE = join(process.cwd(), "scripts", ".whakoom-ivrea-vols.json");
const THROTTLE = 1100; // ms entre fichas (cada ficha ya hace 2 fetches internos)

type VolRow = { title: string; volumes: number } | { error: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const collapse = (s: string) => normalizeTitle(s).replace(/[^a-z0-9]/g, "");
const FORMAT =
  /(rustica|grapa|tapa|cartone|tankobon|kanzenban|deluxe|omnibus|integral|con sobrecubierta|con solapas|portadas alternativas|\d+\s*pp)/g;
const stripFmt = (s: string) => s.replace(/_/g, " ").replace(FORMAT, "").trim();
const tok = (s: string) =>
  normalizeTitle(s)
    .split(" ")
    .filter((w) => w.length >= 2);
const slugOf = (u: string) => u.match(/\/ediciones\/\d+\/([^/?]+)/)?.[1] ?? u;

async function loadUrls(refresh: boolean): Promise<string[]> {
  if (!refresh && existsSync(URLS_CACHE))
    return JSON.parse(readFileSync(URLS_CACHE, "utf8"));
  console.log("Enumerando Ivrea en Whakoom (throttleado)…");
  const urls = await enumeratePublisherEditions(ALL_URL, {
    throttleMs: 700,
    onPage: (p, t) => console.log(`  página ${p}: ${t} ediciones`),
  });
  writeFileSync(URLS_CACHE, JSON.stringify(urls));
  return urls;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const urls = await loadUrls(refresh);
  console.log(`Whakoom Ivrea: ${urls.length} ediciones.\n`);

  // Cache de conteos por URL (resumible).
  const cache: Record<string, VolRow> = existsSync(VOLS_CACHE)
    ? JSON.parse(readFileSync(VOLS_CACHE, "utf8"))
    : {};
  const save = () => writeFileSync(VOLS_CACHE, JSON.stringify(cache));

  const pending = urls.filter((u) => !(u in cache));
  console.log(`Fichas a buscar: ${pending.length} (ya en cache: ${urls.length - pending.length}).`);
  let i = 0;
  for (const u of pending) {
    i++;
    const ed = await getWhakoomEdition(u).catch((e) => ({ error: String(e) }) as const);
    if (!ed || "error" in ed) cache[u] = { error: (ed as { error?: string })?.error ?? "no parse" };
    else cache[u] = { title: ed.title, volumes: ed.volumes };
    if (i % 10 === 0) {
      save();
      console.log(`  …${i}/${pending.length}  (${u.slice(-40)} → ${"volumes" in cache[u] ? (cache[u] as { volumes: number }).volumes : "ERR"})`);
    }
    await sleep(THROTTLE);
  }
  save();
  const errs = Object.values(cache).filter((v) => "error" in v).length;
  console.log(`\nFichas con datos: ${Object.keys(cache).length - errs}, con error: ${errs}.`);

  // Nuestras ediciones Ivrea.
  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: { publisher: "Ivrea Argentina" },
      select: { id: true, title: true, normTitle: true, volumes: true,
        work: { select: { id: true, title: true, originalTitle: true } } },
    }),
  );
  // Índices para matchear: colapsado exacto + sets de tokens.
  const byCollapsed = new Map<string, (typeof eds)[number]>();
  const tokIndex: { ed: (typeof eds)[number]; set: Set<string> }[] = [];
  for (const e of eds) {
    for (const s of [e.normTitle, e.work?.originalTitle].filter(Boolean) as string[]) {
      const c = collapse(s);
      if (c.length >= 4 && !byCollapsed.has(c)) byCollapsed.set(c, e);
      const set = new Set(tok(s));
      if (set.size) tokIndex.push({ ed: e, set });
    }
  }
  const matchEd = (whaTitle: string, url: string): (typeof eds)[number] | null => {
    const base = collapse(stripFmt(whaTitle || slugOf(url)));
    if (byCollapsed.has(base)) return byCollapsed.get(base)!;
    const slugSet = new Set(tok(stripFmt((whaTitle || slugOf(url)).replace(/_/g, " "))));
    if (!slugSet.size) return null;
    const hit = tokIndex.find((t) => [...t.set].every((x) => slugSet.has(x)));
    return hit?.ed ?? null;
  };

  // Whakoom vol (máximo entre variantes de formato) por nuestra edición.
  const whaVol = new Map<number, { vol: number; title: string }>();
  const unmatched: string[] = [];
  for (const u of urls) {
    const row = cache[u];
    if (!row || "error" in row) continue;
    const e = matchEd(row.title, u);
    if (!e) { unmatched.push(`${row.title} (${row.volumes}t)`); continue; }
    const cur = whaVol.get(e.id);
    if (!cur || row.volumes > cur.vol) whaVol.set(e.id, { vol: row.volumes, title: row.title });
  }

  // Diferencias.
  type Diff = { our: number; wha: number; ourTitle: string; whaTitle: string; workId: number };
  const diffs: Diff[] = [];
  const noWhaList: { title: string; vol: number; workId: number }[] = [];
  let same = 0;
  for (const e of eds) {
    const w = whaVol.get(e.id);
    if (!w) { noWhaList.push({ title: e.title, vol: e.volumes, workId: e.work?.id ?? 0 }); continue; }
    if (w.vol === e.volumes) same++;
    else diffs.push({ our: e.volumes, wha: w.vol, ourTitle: e.title, whaTitle: w.title, workId: e.work?.id ?? 0 });
  }
  const noWha = noWhaList.length;
  diffs.sort((a, b) => Math.abs(b.wha - b.our) - Math.abs(a.wha - a.our));

  console.log(`\n=== RESUMEN ===`);
  console.log(`Nuestras ediciones Ivrea: ${eds.length}`);
  console.log(`  · conteo IGUAL a Whakoom: ${same}`);
  console.log(`  · conteo DISTINTO:        ${diffs.length}`);
  console.log(`  · sin match en Whakoom:   ${noWha}`);
  console.log(`Ediciones de Whakoom sin match nuestro: ${unmatched.length}`);

  console.log(`\n=== DIFERENCIAS (nuestro vs Whakoom, |Δ| desc) ===`);
  for (const d of diffs)
    console.log(`  ${d.our} → ${d.wha}  (Δ${d.wha - d.our >= 0 ? "+" : ""}${d.wha - d.our})  "${d.ourTitle}" (#${d.workId})`);

  console.log(`\n=== Nuestras sin match en Whakoom (${noWha}) ===`);
  noWhaList
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((n) => console.log(`  · ${n.title} (${n.vol}t, #${n.workId})`));

  if (unmatched.length) {
    console.log(`\n=== Whakoom sin match nuestro (${unmatched.length}) ===`);
    unmatched.slice(0, 30).forEach((u) => console.log(`  · ${u}`));
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
