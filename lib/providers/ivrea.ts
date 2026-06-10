import * as cheerio from "cheerio";

export interface IvreaData {
  publisher: string;
  slug: string;
  title: string;
  url: string;
  argentinaStatus: string;
  argentinaVolumes: number;
  japanStatus: string;
  japanVolumes: number;
  nextVolume: number | null;
}

const BASE = "https://www.ivrea.com.ar";

/**
 * Obtiene los datos de una ficha de Ivrea por su slug.
 *
 * Ojo: Ivrea responde 200 incluso para slugs inexistentes, pero en ese caso
 * redirige al home, así que validamos que sigamos en una URL de ficha.
 */
export async function getIvreaDataBySlug(
  slug: string,
): Promise<IvreaData | null> {
  const url = `${BASE}/titulo/${slug}/`;

  const response = await fetch(url);

  if (!response.ok || !isTitlePage(response)) return null;

  const html = await response.text();
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");

  const argentina = parseArgentina(text);
  const japan = matchEstado(text, "JAPÓN");
  const nextMatch = text.match(/PR[ÓO]XIMO TOMO A LA VENTA:\s*#?(\d+)/i);

  return {
    publisher: "Ivrea Argentina",
    slug,
    // El <h1> a veces viene con HTML escapado; lo limpiamos.
    title: cheerio
      .load($("h1").first().text() || "")("body")
      .text()
      .trim(),
    url,
    argentinaStatus: argentina.status,
    argentinaVolumes: argentina.volumes,
    japanStatus: japan.status,
    japanVolumes: japan.volumes,
    nextVolume: nextMatch ? Number(nextMatch[1]) : null,
  };
}

/**
 * Resuelve la edición de Ivrea a partir de un título de AniList.
 *
 * Estrategia:
 *   1. Si conocemos el slug (guardado en la colección), lo usamos directo.
 *   2. Probamos un slug derivado del título (rápido, evita la búsqueda).
 *   3. Buscamos en el sitio (`?s=`) y validamos los mejores candidatos.
 *
 * `titles` puede incluir varias formas (inglés, romaji) para maximizar el match.
 */
export async function getIvreaEdition(
  titles: string | string[],
  knownSlug?: string | null,
): Promise<IvreaData | null> {
  if (knownSlug) {
    const data = await getIvreaDataBySlug(knownSlug);
    if (data) return data;
  }

  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);

  // 1) Slug directo a partir de cada título.
  for (const title of titleList) {
    const data = await getIvreaDataBySlug(slugify(title));
    if (data) return data;
  }

  // 2) Búsqueda en el sitio.
  for (const title of titleList) {
    const candidates = await searchIvrea(title);

    for (const slug of candidates) {
      const data = await getIvreaDataBySlug(slug);
      if (data) return data;
    }
  }

  return null;
}

/**
 * Busca títulos en Ivrea vía el buscador de WordPress (`?s=`) y devuelve los
 * slugs candidatos ordenados por cercanía al término buscado.
 */
export async function searchIvrea(title: string): Promise<string[]> {
  const response = await fetch(`${BASE}/?s=${encodeURIComponent(title)}`);

  if (!response.ok) return [];

  const html = await response.text();

  const slugs = [
    ...new Set(
      [...html.matchAll(/\/titulo\/([^/"'?#]+)\//g)].map((m) => m[1]),
    ),
  ];

  const target = normalize(title);

  return slugs
    .map((slug) => ({ slug, score: scoreSlug(slug, target) }))
    // Gate de relevancia: descarta los links genéricos (populares/sidebar)
    // que Ivrea muestra cuando la búsqueda no tiene resultados reales.
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.slug);
}

// --- helpers ---------------------------------------------------------------

function isTitlePage(response: Response): boolean {
  // Un slug inexistente redirige al home; una ficha real mantiene /titulo/.
  return !response.redirected && response.url.includes("/titulo/");
}

const STATUS = "([A-Za-zÁÉÍÓÚáéíóú ]+?)";
const DASH = "\\s*[-–—]\\s*";

/**
 * Extrae los tomos publicados en Argentina cubriendo los tres layouts de Ivrea:
 *   1. "ESTADO EN ARGENTINA: EN CURSO – 107 TOMOS"   (fichas nuevas)
 *   2. "ESTADO: COMPLETA – 74 TOMOS"                 (fichas viejas, varias ediciones)
 *   3. "SERIE DE: 11 TOMOS"                          (kanzenban/recopilatorios)
 */
function parseArgentina(text: string): { status: string; volumes: number } {
  // 1) Layout nuevo, explícito para Argentina.
  const ar = text.match(
    new RegExp(`ESTADO EN ARGENTINA:?\\s*${STATUS}${DASH}(\\d+)\\s*TOMOS`, "i"),
  );
  if (ar) return { status: ar[1].trim().toUpperCase(), volumes: Number(ar[2]) };

  // 2) Layout viejo con "ESTADO:" (colon inmediato). Puede haber varias
  //    ediciones; nos quedamos con la de más tomos (serie completa).
  const generic = [
    ...text.matchAll(new RegExp(`ESTADO:\\s*${STATUS}${DASH}(\\d+)\\s*TOMOS`, "gi")),
  ];
  if (generic.length) {
    const best = generic.reduce((a, b) => (Number(b[2]) > Number(a[2]) ? b : a));
    return { status: best[1].trim().toUpperCase(), volumes: Number(best[2]) };
  }

  // 3) "SERIE DE: N TOMOS".
  const serie = text.match(/SERIE DE:?\s*(\d+)\s*TOMOS/i);
  if (serie) return { status: "UNKNOWN", volumes: Number(serie[1]) };

  return { status: "UNKNOWN", volumes: 0 };
}

function matchEstado(
  text: string,
  pais: "JAPÓN",
): { status: string; volumes: number } {
  const re = new RegExp(
    `ESTADO EN JAP[ÓO]N:?\\s*${STATUS}${DASH}(\\d+)\\s*TOMOS`,
    "i",
  );
  const m = text.match(re);

  return {
    status: m?.[1]?.trim().toUpperCase() ?? "UNKNOWN",
    volumes: Number(m?.[2] ?? 0),
  };
}

function slugify(value: string): string {
  return normalize(value).replace(/\s+/g, "-");
}

/**
 * Puntúa la relevancia de un slug respecto al título buscado.
 * Devuelve > 0 solo si hay una coincidencia real; 0 o menos para descartar.
 *
 * Maneja dos formas de coincidencia:
 *   - Tokens compartidos (p. ej. "atelier-of-witch-hat" ~ "witch hat atelier").
 *   - Forma colapsada sin separadores (p. ej. "spyxfamily" ~ "spy x family").
 */
function scoreSlug(slug: string, target: string): number {
  const slugNorm = slug.replace(/-/g, " ");
  const collapsedSlug = slugNorm.replace(/ /g, "");
  const collapsedTarget = target.replace(/ /g, "");

  // Coincidencia exacta (colapsada): el mejor caso posible.
  if (collapsedSlug === collapsedTarget) return 100;

  const targetTokens = target.split(" ").filter(Boolean);
  const slugTokens = slugNorm.split(" ").filter(Boolean);
  const targetSet = new Set(targetTokens);
  const overlap = slugTokens.filter((t) => targetSet.has(t)).length;

  // Substring colapsado (un título contiene al otro): match fuerte.
  // Ej.: "chainsawman" ⊂ "chainsawmanfranquicia".
  const collapsedMatch =
    collapsedTarget.length >= 4 &&
    (collapsedSlug.includes(collapsedTarget) ||
      collapsedTarget.includes(collapsedSlug));

  // Umbral: títulos de una sola palabra exigen esa palabra; los de varias,
  // al menos la mitad de los tokens. Evita falsos positivos genéricos.
  const needed = targetTokens.length <= 1 ? 1 : Math.ceil(targetTokens.length / 2);
  const relevant = collapsedMatch || overlap >= needed;

  if (!relevant) return 0;

  let score = 50 + overlap * 10;
  if (collapsedMatch) score += 20;
  // Penaliza slugs más largos (spin-offs, ediciones especiales, franquicias).
  score -= Math.abs(slugTokens.length - targetTokens.length) * 3;

  return score;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
