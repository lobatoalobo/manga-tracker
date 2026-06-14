import * as cheerio from "cheerio";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";
import { getPaniniEdition } from "../lib/providers/panini";
import { upsertPublisherEdition } from "../lib/catalog";
import { seedMangakaIndex } from "../lib/mangakas";
import { resolveEditionSeries } from "../lib/resolveSeries";
import {
  importWhakoomUrls,
  enumeratePublisherEditions,
} from "../lib/whakoomImport";
import { logJobRun, groupSkipReasons } from "../lib/jobs";
import { detectAndNotifyNewVolumes } from "../lib/catalogNotify";
import { prisma } from "../lib/prisma";
import { readFileSync } from "fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UA = { "User-Agent": "Mozilla/5.0" };

// --- helpers ---------------------------------------------------------------

async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        await fn(items[idx], idx);
      } catch {
        /* seguimos */
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}

function humanize(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function dropOutliers(volumes: number[]): number[] {
  const sorted = [...volumes].sort((a, b) => a - b);
  while (sorted.length >= 2) {
    const max = sorted[sorted.length - 1];
    const second = sorted[sorted.length - 2];
    if (max > second * 2 && max > 50) sorted.pop();
    else break;
  }
  return sorted;
}

// --- Ivrea: /catalogo/ (500 títulos) -> ficha de cada uno -------------------

async function crawlIvrea() {
  console.log("\n=== Ivrea ===");
  // El fetch del catálogo va con retry: desde CI a veces falla la red/IP y un
  // throw acá tira todo el crawl (exit 1).
  let html = "";
  for (let a = 0; a < 3 && !html; a++) {
    try {
      const r = await fetch("https://www.ivrea.com.ar/catalogo/", { headers: UA });
      if (r.ok) html = await r.text();
    } catch {
      /* reintenta */
    }
    if (!html) await new Promise((res) => setTimeout(res, 2000));
  }
  if (!html) {
    console.error("  No se pudo bajar el catálogo de Ivrea (red). Abortando Ivrea.");
    return;
  }
  const $ = cheerio.load(html);

  const titles = new Map<string, string>(); // slug -> title
  $("a[href*='/titulo/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/titulo\/([^/]+)\//);
    if (m) {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (!titles.has(m[1]) || text) titles.set(m[1], text || humanize(m[1]));
    }
  });

  const entries = [...titles.entries()];
  console.log(`  ${entries.length} títulos en el catálogo. Trayendo fichas…`);

  let done = 0;
  let saved = 0;
  await pool(entries, 6, async ([slug, title]) => {
    const d = await getIvreaDataBySlug(slug);
    done++;
    if (d && d.argentinaVolumes > 0) {
      await upsertPublisherEdition({
        publisher: "Ivrea Argentina",
        slug,
        title: d.title || title,
        volumes: d.argentinaVolumes,
        status: d.argentinaStatus,
        url: d.url,
      });
      saved++;
    }
    if (done % 50 === 0) console.log(`  ${done}/${entries.length} (guardados: ${saved})`);
  });
  console.log(`  Ivrea: ${saved} ediciones indexadas.`);
}

// --- Panini: /planet-manga/<serie> -----------------------------------------

async function crawlPanini() {
  console.log("\n=== Panini ===");
  const BASE = "https://tiendapanini.com.ar";
  const html = await (await fetch(`${BASE}/planet-manga`, { headers: UA })).text();
  const subcats = [
    ...new Set([...html.matchAll(/\/planet-manga\/([a-z0-9-]+)\/?"/g)].map((m) => m[1])),
  ].filter((s) => s !== "outros");

  console.log(`  ${subcats.length} categorías de serie.`);

  // Reusamos el resolver por búsqueda (más confiable que parsear la categoría):
  // tomamos el nombre de la serie de la categoría y dejamos que resuelva el total.
  let saved = 0;
  await pool(subcats, 4, async (slug) => {
    const data = await getPaniniEdition([humanize(slug)]);
    if (data && data.totalVolumes > 0) {
      await upsertPublisherEdition({
        publisher: "Panini Argentina",
        slug,
        title: humanize(slug),
        volumes: data.totalVolumes,
        status: "EN CATÁLOGO",
        url: `${BASE}/planet-manga/${slug}`,
      });
      saved++;
    }
  });
  console.log(`  Panini: ${saved} ediciones indexadas.`);
}

// --- Ovni: sitemap -> agrupar por serie -------------------------------------

async function crawlOvni() {
  console.log("\n=== Ovni ===");
  const xml = await (await fetch("https://www.ovnipress.net/sitemap.xml", { headers: UA })).text();
  const slugs = [
    ...xml.matchAll(/<loc>https:\/\/www\.ovnipress\.net\/productos\/([^<]+?)\/<\/loc>/g),
  ].map((m) => m[1]);

  const series = new Map<string, number[]>();
  for (const s of slugs) {
    const m = s.match(/^(.*?)-vol-(\d+)(?:-|$)/);
    if (m) {
      const arr = series.get(m[1]) ?? [];
      arr.push(Number(m[2]));
      series.set(m[1], arr);
    }
  }

  let saved = 0;
  for (const [slug, vols] of series) {
    const cleaned = dropOutliers(vols);
    if (!cleaned.length) continue;
    await upsertPublisherEdition({
      publisher: "Ovni Press",
      slug,
      title: humanize(slug),
      volumes: Math.max(...cleaned),
      status: "EN CATÁLOGO",
      url: `https://www.ovnipress.net/search/?q=${encodeURIComponent(slug.replace(/-/g, " "))}`,
    });
    saved++;
  }
  console.log(`  Ovni: ${saved} series indexadas.`);
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

async function crawlWhakoomPublisher(allUrl: string, reset: boolean) {
  console.log("\n=== Importar editorial completa desde Whakoom ===");
  const startedAt = new Date();

  if (reset) {
    const u = allUrl.toLowerCase();
    const publisher = u.includes("panini")
      ? "Panini Argentina"
      : u.includes("ivrea")
        ? "Ivrea Argentina"
        : u.includes("ovni")
          ? "Ovni Press"
          : null;
    if (publisher) {
      const r = await prisma.publisherEdition.deleteMany({ where: { publisher } });
      console.log(`  Reset: borradas ${r.count} entradas viejas de ${publisher}.`);
    }
  }

  console.log(`  Enumerando ediciones de ${allUrl}…`);
  const urls = await enumeratePublisherEditions(allUrl, {
    onPage: (p, total) => {
      if (p % 5 === 0) console.log(`  página ${p}: ${total} ediciones`);
    },
  });
  console.log(`  ${urls.length} ediciones encontradas. Importando + mapeando…`);
  const res = await importWhakoomUrls(urls, {
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

  const which = process.argv[2]; // ivrea|panini|ovni|mangakas|resolve|whakoom*
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
    await crawlWhakoomPublisher(url, process.argv[4] === "reset");
    console.log("\nListo.");
    return;
  }
  if (!which || which === "ovni") await crawlOvni();
  if (!which || which === "panini") await crawlPanini();
  if (!which || which === "ivrea") await crawlIvrea();
  if (!which || which === "mangakas") await crawlMangakas();
  await notifyNewVolumes();
  console.log("\nListo.");
}

/** Tras actualizar conteos, avisa "tomo nuevo" a los coleccionistas. */
async function notifyNewVolumes() {
  try {
    const nv = await detectAndNotifyNewVolumes();
    console.log(
      `  Tomos nuevos: ${nv.notifications} notificaciones en ${nv.changed} ediciones.`,
    );
  } catch (e) {
    console.error("  notifyNewVolumes falló (no frena el crawl):", e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
