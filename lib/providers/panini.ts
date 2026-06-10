import * as cheerio from "cheerio";

const BASE = "https://tiendapanini.com.ar";
const PER_PAGE = 12; // Magento fija la página en 12 ítems.
const MAX_PAGES = 8; // Tope de seguridad.
const DAY = 60 * 60 * 24;

export interface PaniniData {
  publisher: string;
  /** Tomo más alto editado por Panini (mejor estimación de la tirada local). */
  totalVolumes: number;
  /** Tomos distintos listados en el catálogo (puede haber huecos). */
  listed: number;
  url: string; // link a la búsqueda en la tienda
}

interface Product {
  name: string;
  href: string;
}

/**
 * Resuelve la edición de Panini para una serie.
 *
 * Panini es una tienda Magento donde cada tomo es un producto. Distinguimos:
 *   - totalVolumes: el tomo más alto editado (cota de la tirada local).
 *   - listed: cuántos tomos figuran en el catálogo (con o sin stock).
 */
export async function getPaniniEdition(
  titles: string | string[],
): Promise<PaniniData | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  const targets = titleList.map(normalize);

  for (const title of titleList) {
    const products = await searchAllPages(title);
    if (products.length === 0) continue;

    const volumes = new Set<number>();

    for (const { name } of products) {
      const parsed = parseProduct(name);
      if (parsed && targets.some((t) => seriesMatches(parsed.series, t))) {
        volumes.add(parsed.volume);
      }
    }

    if (volumes.size === 0) continue;

    return {
      publisher: "Panini Argentina",
      totalVolumes: Math.max(...volumes),
      listed: volumes.size,
      url: `${BASE}/catalogsearch/result/?q=${encodeURIComponent(title)}`,
    };
  }

  return null;
}

// --- internals -------------------------------------------------------------

async function searchAllPages(term: string): Promise<Product[]> {
  const first = await fetchPage(term, 1);
  const pages = Math.min(Math.ceil(first.total / PER_PAGE), MAX_PAGES);

  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      fetchPage(term, i + 2).then((r) => r.products),
    ),
  );

  const byHref = new Map<string, Product>();
  for (const p of [first.products, ...rest].flat()) byHref.set(p.href, p);
  return [...byHref.values()];
}

async function fetchPage(
  term: string,
  page: number,
): Promise<{ products: Product[]; total: number }> {
  const url = `${BASE}/catalogsearch/result/?q=${encodeURIComponent(term)}&p=${page}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: DAY },
  });

  if (!r.ok) return { products: [], total: 0 };

  const $ = cheerio.load(await r.text());

  const products: Product[] = [];
  $("a.product-item-link").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const name = $(el).text().trim().replace(/\s+/g, " ");
    if (href) products.push({ name, href });
  });

  const total =
    Number($(".toolbar-amount").first().text().match(/de\s+(\d+)/i)?.[1]) ||
    products.length;

  return { products, total };
}

/**
 * Extrae serie y número de tomo del nombre de un producto, cubriendo las
 * variantes de Panini: "NARUTO 17", "BAKEMONOGATARI N.16", "Bakemonogatari #11",
 * "TOMO 3", etc.
 */
function parseProduct(name: string): { series: string; volume: number } | null {
  const clean = name.replace(/\(.*?\)/g, "").trim();
  // El número puede venir como "17", "N.16", "#11", "N.22*" (con basura final).
  const m = clean.match(
    /^(.*?)[\s#]*(?:n[°º.]?\s*|tomo\s*|vol(?:umen)?\.?\s*)?(\d{1,3})\D*$/i,
  );
  if (!m) return null;

  const series = normalize(m[1]);
  if (!series) return null;

  return { series, volume: Number(m[2]) };
}

/**
 * ¿El nombre de serie del producto corresponde al título buscado?
 * Exacto siempre; para títulos largos (≥10) tolera hasta 2 typos de Panini
 * (p. ej. "BAKEMONOGATATARI"), sin arriesgar falsos positivos en títulos
 * cortos parecidos (Naruto/Boruto).
 */
function seriesMatches(series: string, target: string): boolean {
  if (series === target) return true;
  if (target.length >= 10 && levenshtein(series, target) <= 2) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[a.length];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
