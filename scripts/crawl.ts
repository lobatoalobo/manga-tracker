import * as cheerio from "cheerio";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";
import { getPaniniEdition } from "../lib/providers/panini";
import { upsertPublisherEdition } from "../lib/catalog";
import { seedMangakaIndex } from "../lib/mangakas";
import { resolveEditionSeries } from "../lib/resolveSeries";
import { prisma } from "../lib/prisma";

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
  const html = await (await fetch("https://www.ivrea.com.ar/catalogo/", { headers: UA })).text();
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
async function crawlResolve(reset: boolean) {
  console.log("\n=== Resolver ediciones → AniList (verificado por autor) ===");
  if (reset) {
    const r = await prisma.publisherEdition.updateMany({ data: { anilistId: null } });
    console.log(`  Reset: ${r.count} mapeos borrados.`);
  }

  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: null },
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

async function main() {
  const which = process.argv[2]; // ivrea | panini | ovni | mangakas | resolve
  if (which === "resolve") {
    await crawlResolve(process.argv[3] === "reset");
    console.log("\nListo.");
    return;
  }
  if (!which || which === "ovni") await crawlOvni();
  if (!which || which === "panini") await crawlPanini();
  if (!which || which === "ivrea") await crawlIvrea();
  if (!which || which === "mangakas") await crawlMangakas();
  console.log("\nListo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
