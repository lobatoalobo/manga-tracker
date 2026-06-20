import { seedMangakaIndex } from "../lib/mangakas";
import { resolveEditionSeries } from "../lib/resolveSeries";
import {
  importWhakoomUrls,
  enumeratePublisherEditions,
} from "../lib/whakoomImport";
import { logJobRun, groupSkipReasons } from "../lib/jobs";
import {
  importVizSeries,
  VIZ_SEED,
  discoverVizFromGoogleBooks,
  backfillMangadexCovers,
  fillMissingVizCovers,
} from "../lib/vizImport";
import { crawlIvreaCatalog } from "../lib/ivreaCatalog";
import {
  detectAndNotifyNewVolumes,
  detectAndNotifyWishlistAvailable,
  baselineNotifiedVolumes,
} from "../lib/catalogNotify";
import { prisma } from "../lib/prisma";
import { readFileSync } from "fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Editorial a partir de una URL /publisher/<id>/<slug>/all de Whakoom. */
function publisherFromAllUrl(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("panini")) return "Panini Argentina";
  if (u.includes("ivrea")) return "Ivrea Argentina";
  if (u.includes("ovni")) return "Ovni Press";
  if (u.includes("kemuri")) return "Kemuri Ediciones";
  if (u.includes("utopia")) return "Utopía Editorial";
  if (u.includes("larp")) return "Larp Editores";
  if (u.includes("distrito")) return "Distrito Manga";
  if (u.includes("planeta")) return "Planeta Cómic";
  return null;
}

// --- Ivrea: /catalogo/ (lib/ivreaCatalog) ----------------------------------

async function crawlIvrea() {
  console.log("\n=== Ivrea ===");
  const r = await crawlIvreaCatalog();
  console.log(`  Ivrea: ${r.saved}/${r.catalog} ediciones indexadas.`);
}

/**
 * Catálogo VIZ (inglés): procesa el seed (lib/vizImport.VIZ_SEED) creando/
 * asociando Works + ediciones VIZ (en/US). MU/MD no bloquean datacenter, así
 * que puede correr en Vercel. Ver docs/plan-viz-en.md.
 */
async function crawlViz(extra: string[] = []) {
  console.log("\n=== Catálogo VIZ (inglés) ===");
  const titles: (string | string[])[] = [...VIZ_SEED, ...extra];
  let ok = 0;
  const skipped: string[] = [];
  for (const t of titles) {
    const label = Array.isArray(t) ? t[0] : t;
    const r = await importVizSeries(t);
    if (r.ok) {
      ok++;
      console.log(`  ✓ ${r.title} (${r.volumes} tomos)`);
    } else {
      skipped.push(`${label} — ${r.reason}`);
    }
    await sleep(800); // respeta el rate-limit de MU/MD
  }
  console.log(`\n  VIZ: ${ok} importadas · ${skipped.length} salteadas`);
  if (skipped.length) console.log("  Salteadas:\n   " + skipped.join("\n   "));
}

async function crawlMangakas() {
  console.log("\n=== Mangakas (índice alfabético) ===");
  const inserted = await seedMangakaIndex();
  console.log(`  Mangakas: ${inserted} autores nuevos indexados.`);
}

/**
 * Resuelve (verificado por autor) el anilistId de cada edición del catálogo, así
 * el badge/links usan el mapeo correcto en vez de matchear por título.
 * `npm run crawl resolve` resuelve las que faltan; `resolve reset` borra primero
 * el mapeo (para re-resolver todo desde cero).
 */
async function crawlResolve(reset: boolean, publisher?: string) {
  console.log("\n=== Resolver ediciones → AniList (verificado por autor) ===");
  const pubWhere = publisher ? { publisher } : {};
  if (reset) {
    const r = await prisma.publisherEdition.updateMany({
      where: pubWhere,
      data: { anilistId: null },
    });
    console.log(
      `  Reset: ${r.count} mapeos borrados${publisher ? ` de ${publisher}` : ""}.`,
    );
  }

  const rows = await prisma.publisherEdition.findMany({
    where: { ...pubWhere, anilistId: null },
    select: { id: true, publisher: true, slug: true, title: true },
  });
  console.log(`  ${rows.length} ediciones a resolver…`);

  let done = 0;
  let mapped = 0;
  for (const row of rows) {
    const anilistId = await resolveEditionSeries(row).catch(() => null);
    if (anilistId) {
      await prisma.publisherEdition
        .update({ where: { id: row.id }, data: { anilistId } })
        .catch(() => {});
      mapped++;
    }
    done++;
    if (done % 25 === 0)
      console.log(`  ${done}/${rows.length} (mapeadas: ${mapped})`);
    await sleep(1000); // respetar rate-limit de AniList (varias búsquedas/fila)
  }
  console.log(`  Resueltas: ${mapped}/${rows.length}.`);
}

async function crawlWhakoom(file: string) {
  console.log("\n=== Importar ediciones desde Whakoom ===");
  const urls = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  console.log(`  ${urls.length} URLs en ${file}…`);
  const res = await importWhakoomUrls(urls, {
    onProgress: (p) => {
      if (p.done % 10 === 0)
        console.log(`  ${p.done}/${p.total} (mapeadas: ${p.mapped})`);
    },
  });
  console.log(
    `  Importadas: ${res.imported} · mapeadas: ${res.mapped} · salteadas: ${res.skipped.length}`,
  );
  if (res.skipped.length)
    console.log("  Salteadas:\n   " + res.skipped.slice(0, 30).join("\n   "));
}

// URLs /all de las editoriales que viven SOLO de Whakoom (Ivrea va por su sitio;
// Planeta queda afuera: catálogo enorme y mitad no-manga, se cura a mano).
const WHAKOOM_ALL_URLS = [
  "https://www.whakoom.com/publisher/20930/panini_comics_argentina/all",
  "https://www.whakoom.com/publisher/15389/ovni_press/all",
  "https://www.whakoom.com/publisher/37785/kemuri_ediciones/all",
  "https://www.whakoom.com/publisher/19718/utopia_editorial/all",
  "https://www.whakoom.com/publisher/15398/larp_editores/all",
  "https://www.whakoom.com/publisher/38673/distrito_manga/all",
];

async function crawlWhakoomPublisher(
  allUrl: string,
  reset: boolean,
  baseline: boolean,
  tail = true,
  skipExisting = false,
) {
  console.log("\n=== Importar editorial completa desde Whakoom ===");
  const startedAt = new Date();
  const publisher = publisherFromAllUrl(allUrl);

  if (reset && publisher) {
    const r = await prisma.publisherEdition.deleteMany({ where: { publisher } });
    console.log(`  Reset: borradas ${r.count} entradas viejas de ${publisher}.`);
  }

  console.log(`  Enumerando ediciones de ${allUrl}…`);
  const urls = await enumeratePublisherEditions(allUrl, {
    onPage: (p, total) => {
      if (p % 5 === 0) console.log(`  página ${p}: ${total} ediciones`);
    },
  });
  console.log(`  ${urls.length} ediciones encontradas. Importando + mapeando…`);
  const res = await importWhakoomUrls(urls, {
    skipExisting,
    onProgress: (pr) => {
      if (pr.done % 20 === 0)
        console.log(`  ${pr.done}/${pr.total} (mapeadas: ${pr.mapped})`);
    },
  });
  console.log(
    `  Importadas: ${res.imported} · mapeadas: ${res.mapped} · salteadas: ${res.skipped.length}`,
  );

  const reasons = groupSkipReasons(res.skipped);
  await logJobRun({
    kind: "whakoom-import",
    label: allUrl,
    processed: res.processed,
    imported: res.imported,
    mapped: res.mapped,
    skipped: res.skipped.length,
    summary: { reasons, found: urls.length },
    startedAt,
  });
  console.log("  Motivos de skip:", reasons);

  if (!tail) return; // whakoom-all maneja la notificación una sola vez al final

  if (baseline) {
    // Corrección de conteos viejos malos: re-baselinamos sin notificar para no
    // spamear "tomo nuevo" por tomos que ya existían (solo el dato estaba mal).
    const n = await baselineNotifiedVolumes(publisher ?? undefined);
    console.log(`  Baseline: ${n} ediciones re-baselizadas (sin notificar).`);
  } else {
    await notifyNewVolumes();
  }
}

/**
 * Import programado de TODAS las editoriales que viven de Whakoom (set & forget).
 * Importa una por una y notifica "tomo nuevo" UNA sola vez al final. Las ediciones
 * nuevas se baselean solas en silencio (notifiedVolumes 0), así que no spamea.
 * Corre en el self-hosted runner (Whakoom bloquea a los runners de GitHub).
 */
async function crawlWhakoomAll() {
  for (const url of WHAKOOM_ALL_URLS) {
    try {
      // Incremental: solo trae ediciones NUEVAS (no re-abre las que ya tenemos).
      await crawlWhakoomPublisher(url, false, false, false, true);
    } catch (e) {
      console.error(`  Falló ${url} (sigo con el resto):`, e);
    }
    await sleep(2000);
  }
  await notifyNewVolumes();
}

async function main() {
  // Falla rápido y claro si la DATABASE_URL no es válida (secret mal pegado en
  // CI), en vez de un stack críptico de Prisma a mitad del crawl.
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
    console.error(
      `DATABASE_URL inválida o ausente: debe empezar con "postgresql://". ` +
        `(largo=${dbUrl.length}) — revisá el secret DATABASE_URL en GitHub: ` +
        `pegá solo la connection string, sin "DATABASE_URL=" ni comillas.`,
    );
    process.exit(1);
  }

  const which = process.argv[2]; // ivrea|mangakas|resolve|whakoom*|viz
  if (which === "whakoom-all") {
    await crawlWhakoomAll();
    console.log("\nListo.");
    return;
  }
  if (which === "viz") {
    // viz [titulo extra…]  → procesa el seed + títulos sueltos opcionales
    await crawlViz(process.argv.slice(3));
    console.log("\nListo.");
    return;
  }
  if (which === "viz-covers") {
    // viz-covers  → reescribe al proxy las portadas de MangaDex ya guardadas
    const n = await backfillMangadexCovers();
    console.log(`\nPortadas de MangaDex reescritas al proxy: ${n}`);
    return;
  }
  if (which === "viz-fillcovers") {
    // viz-fillcovers [limit]  → rellena portadas faltantes de obras VIZ (MU/MD → Blob)
    const limit = Number(process.argv[3]) || undefined;
    const r = await fillMissingVizCovers(limit);
    console.log(
      `\nPortadas VIZ: ${r.filled} rellenadas · ${r.failed} sin fuente · de ${r.scanned}`,
    );
    return;
  }
  if (which === "viz-discover") {
    // viz-discover [limit]  → enumera VIZ con Google Books y los importa (MU confirma)
    const limit = Number(process.argv[3]) || undefined;
    console.log("\n=== Descubrir VIZ (Google Books) ===");
    const r = await discoverVizFromGoogleBooks({ limit });
    if (r.noKey) console.log("  Falta GOOGLE_BOOKS_API_KEY.");
    else
      console.log(
        `  Google Books: ${r.source} títulos · ${r.candidates} nuevos · ` +
          `${r.imported} importados · ${r.skipped} salteados`,
      );
    console.log("\nListo.");
    return;
  }
  if (which === "resolve") {
    // resolve [reset] [publisher]   ej: resolve reset "Ivrea Argentina"
    const reset = process.argv[3] === "reset";
    const publisher = reset ? process.argv[4] : process.argv[3];
    await crawlResolve(reset, publisher || undefined);
    console.log("\nListo.");
    return;
  }
  if (which === "whakoom") {
    const file = process.argv[3];
    if (!file) {
      console.error("Falta el archivo: npm run crawl whakoom urls.txt");
      process.exit(1);
    }
    await crawlWhakoom(file);
    console.log("\nListo.");
    return;
  }
  if (which === "whakoom-pub") {
    const url = process.argv[3];
    if (!url) {
      console.error(
        'Falta la URL: npm run crawl whakoom-pub "https://www.whakoom.com/publisher/20930/panini_comics_argentina/all"',
      );
      process.exit(1);
    }
    const mods = process.argv.slice(4); // reset | baseline | new
    await crawlWhakoomPublisher(
      url,
      mods.includes("reset"),
      mods.includes("baseline"),
      true,
      mods.includes("new"),
    );
    console.log("\nListo.");
    return;
  }
  // Panini/Ovni ya NO se crawlean por sitio (daban conteos malos); vienen de
  // Whakoom (whakoom-all). Por sitio solo queda Ivrea (confiable + preventas).
  if (!which || which === "ivrea") await crawlIvrea();
  if (!which || which === "mangakas") await crawlMangakas();
  await notifyNewVolumes();
  console.log("\nListo.");
}

/** Tras actualizar conteos: avisa "tomo nuevo" (colección) y "salió en AR" (deseados). */
async function notifyNewVolumes() {
  try {
    const nv = await detectAndNotifyNewVolumes();
    console.log(
      `  Tomos nuevos: ${nv.notifications} notificaciones en ${nv.changed} ediciones.`,
    );
  } catch (e) {
    console.error("  notifyNewVolumes falló (no frena el crawl):", e);
  }
  try {
    const w = await detectAndNotifyWishlistAvailable();
    console.log(
      `  Deseados salieron en AR: ${w.notifications} notificaciones (${w.scanned} pendientes).`,
    );
  } catch (e) {
    console.error("  notifyWishlist falló (no frena el crawl):", e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
