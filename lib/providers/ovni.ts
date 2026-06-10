const BASE = "https://www.ovnipress.net";
const DAY = 60 * 60 * 24;

export interface OvniData {
  publisher: string;
  /** Tomo más alto editado por Ovni. */
  totalVolumes: number;
  /** Tomos distintos encontrados en el catálogo. */
  listed: number;
  url: string; // link a la búsqueda en la tienda
}

/**
 * Resuelve la edición de Ovni Press para una serie.
 *
 * Ovni es una tienda Tiendanube cuyo buscador se renderiza por JS, pero el
 * sitemap lista todos los productos como `/productos/<serie>-vol-N/`. Tomamos
 * los productos cuyo slug arranca con la serie buscada y extraemos los tomos.
 */
export async function getOvniEdition(
  titles: string | string[],
): Promise<OvniData | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  const slugs = await getProductSlugs();
  if (slugs.length === 0) return null;

  for (const title of titleList) {
    const target = slugify(title);
    if (target.length < 3) continue;

    const re = new RegExp(`^${escapeRegex(target)}-vol-(\\d+)(?:-|$)`);
    const volumes = new Set<number>();

    for (const slug of slugs) {
      const m = slug.match(re);
      if (m) volumes.add(Number(m[1]));
    }

    if (volumes.size === 0) continue;

    const cleaned = dropOutliers([...volumes]);

    return {
      publisher: "Ovni Press",
      totalVolumes: Math.max(...cleaned),
      listed: cleaned.length,
      url: `${BASE}/search/?q=${encodeURIComponent(title)}`,
    };
  }

  return null;
}

// --- internals -------------------------------------------------------------

async function getProductSlugs(): Promise<string[]> {
  const r = await fetch(`${BASE}/sitemap.xml`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: DAY },
  });
  if (!r.ok) return [];

  const xml = await r.text();
  return [
    ...xml.matchAll(
      /<loc>https:\/\/www\.ovnipress\.net\/productos\/([^<]+?)\/<\/loc>/g,
    ),
  ].map((m) => m[1]);
}

/**
 * Descarta outliers: a veces un slug trae un número espurio (SKU) que el
 * parser toma como tomo. Si el máximo es más del doble del segundo, lo quitamos.
 */
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
