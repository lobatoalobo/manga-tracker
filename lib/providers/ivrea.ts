import * as cheerio from "cheerio";
import { authorMatches } from "@/lib/authorMatch";

export interface IvreaData {
  publisher: string;
  slug: string;
  title: string;
  /** "NOMBRE ORIGINAL" de la ficha (romaji) — matchea mucho mejor en AniList. */
  originalTitle: string | null;
  author: string | null;
  coverImage: string | null;
  synopsis: string | null;
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

  const response = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });

  if (!response.ok || !isTitlePage(response)) return null;

  const html = await response.text();
  const $ = cheerio.load(html);
  // Sacamos scripts/estilos: cheerio.text() incluye el contenido de <script>
  // (p. ej. el JSON del widget de galería) y ensuciaba la sinopsis.
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ");

  const coverImage =
    html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ?? null;
  const synIdx = text.search(/INFORMACI[ÓO]N SOBRE LA OBRA/i);
  let synopsis: string | null = null;
  if (synIdx >= 0) {
    synopsis =
      text
        .slice(synIdx)
        .replace(/INFORMACI[ÓO]N SOBRE LA OBRA/i, "")
        .split(
          /PORTADAS|GALER[ÍI]A|TOMOS PUBLICADOS|TAMBI[ÉE]N TE PUEDEN|MANGA RELEASES|HOME NUEVAS|CALENDARIO DE SALIDAS|¿D[ÓO]NDE COMPRAR|PRODUCTOS RELACIONADOS|PREGUNTAS Y RESPUESTAS|COMPARTIR/i,
        )[0]
        .trim()
        .slice(0, 1500) || null;
  }

  const argentina = parseArgentina(text);
  const japan = matchEstado(text, "JAPÓN");
  const nextMatch = text.match(/PR[ÓO]XIMO TOMO A LA VENTA:\s*#?(\d+)/i);
  // Autor/artista: la ficha los expone como tags <a rel="tag" href="/autor/…">
  // y "/artista/…" (historia y dibujo). Es lo más confiable.
  const people = [
    ...new Set(
      $("a[rel='tag']")
        .filter((_, a) => /\/(autor|artista)\//i.test($(a).attr("href") || ""))
        .map((_, a) => $(a).text().trim())
        .get()
        .filter(Boolean),
    ),
  ];
  // Fallback: "AUTOR: NOMBRE • ..." en texto plano (fichas viejas).
  const authorMatch = text.match(/AUTOR(?:ES)?:\s*([^•·|\n]+)/i);
  const author = people.length
    ? people.join(", ")
    : authorMatch
      ? authorMatch[1].trim()
      : null;
  // "NOMBRE ORIGINAL JAPONÉS: TAKOPII NO GENZAI" (o "NOMBRE ORIGINAL: ...").
  const origMatch = text.match(/NOMBRE ORIGINAL[^:]*:\s*([^•·|\n]+)/i);

  return {
    publisher: "Ivrea Argentina",
    slug,
    // El <h1> a veces viene con HTML escapado; lo limpiamos.
    title: cheerio
      .load($("h1").first().text() || "")("body")
      .text()
      .trim(),
    originalTitle: origMatch ? origMatch[1].trim() : null,
    author,
    coverImage,
    synopsis,
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
  authors: string[] = [],
): Promise<IvreaData | null> {
  // Slug guardado en la colección: es de confianza, no se re-valida por autor.
  if (knownSlug) {
    const data = await getIvreaDataBySlug(knownSlug);
    if (data) return data;
  }

  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);

  // Descarta una ficha cuyo título matchea pero el autor no: distintas obras
  // homónimas (p. ej. "Real" de Inoue vs. otra serie llamada "Real").
  const ok = (d: IvreaData | null) =>
    d && authorMatches(authors, d.author) ? d : null;

  // 1) Slug directo a partir de cada título.
  for (const title of titleList) {
    const data = ok(await getIvreaDataBySlug(slugify(title)));
    if (data) return data;
  }

  // 2) Búsqueda en el sitio.
  for (const title of titleList) {
    const candidates = await searchIvrea(title);

    for (const slug of candidates) {
      const data = ok(await getIvreaDataBySlug(slug));
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

export interface IvreaProxima {
  slug: string | null; // null si la tarjeta linkea a /news/ (serie sin ficha aún)
  title: string; // título visible de la tarjeta (sin el "#N")
  volume: number | null; // "#N" = el tomo que viene
  isNewSeries: boolean; // "¡NUEVA SERIE!" → debut
  isLastVolume: boolean; // "¡ÚLTIMO TOMO!"
  isOneShot: boolean; // "¡TOMO ÚNICO!"
  isReissue: boolean; // bajo "REEDICIONES POR TOMO AGOTADO" (tomo agotado reimpreso)
  releaseDate: string | null; // "YYYY-MM-DD" del banner de fecha que agrupa la tarjeta
  coverImage: string | null;
}

const IVREA_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

/** Parsea un banner de fecha de Ivrea ("19 DE JUNIO", "JULIO", "JULIO 2026"). */
function parseIvreaBanner(text: string): string | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  let day = 1, month = 0, year: number | undefined;
  let m = t.match(/^(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/);
  if (m && IVREA_MONTHS[m[2]]) {
    day = Number(m[1]); month = IVREA_MONTHS[m[2]]; year = m[3] ? Number(m[3]) : undefined;
  } else {
    m = t.match(/^([a-z]+)(?:\s+(\d{4}))?$/);
    if (!m || !IVREA_MONTHS[m[1]]) return null;
    month = IVREA_MONTHS[m[1]]; year = m[2] ? Number(m[2]) : undefined;
  }
  const now = new Date();
  if (year == null) {
    // La página mezcla salidas recientes (pasado próximo, arriba) y futuras.
    // Elegimos el año (anterior/actual/siguiente) que deje la fecha MÁS CERCA de
    // hoy, así "29 DE MAYO" no salta a 2027 ni "ENERO" en diciembre al pasado.
    const y0 = now.getFullYear();
    year = [y0 - 1, y0, y0 + 1].reduce((best, y) => {
      const d = Math.abs(new Date(y, month - 1, day).getTime() - now.getTime());
      const db = Math.abs(new Date(best, month - 1, day).getTime() - now.getTime());
      return d < db ? y : best;
    }, y0);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Tarjetas de la página de "Próximas salidas" de Ivrea (/proximas/): la fuente
 * de verdad de qué viene pronto y CUÁNDO. La página agrupa las tarjetas bajo
 * banners de fecha ("19 DE JUNIO"); recorremos en orden y le pegamos a cada
 * tarjeta la fecha del banner vigente. Hay dos tipos de tarjeta:
 *  - Lanzamiento normal: <h2> "TÍTULO #N" dentro de .vc_col-sm-2, con flags
 *    (¡NUEVA SERIE!, ¡ÚLTIMO TOMO!, ¡TOMO ÚNICO!). Las series nuevas / tomo
 *    único linkean a /news/ (no a /titulo/) → slug=null.
 *  - Reedición de tomo agotado: <h3 class="aio-icon-title"> "TÍTULO #N" bajo el
 *    header "REEDICIONES POR TOMO AGOTADO"; siempre con /titulo/ (slug).
 *
 * Ivrea NO está bloqueada en datacenter (a diferencia de Whakoom), así que esto
 * corre tranquilo desde un cron de Vercel.
 */
export async function getIvreaProximas(): Promise<IvreaProxima[]> {
  const response = await fetch(`${BASE}/proximas/`, {
    next: { revalidate: 60 * 60 * 6 },
  });
  if (!response.ok) return [];
  const html = await response.text();
  const $ = cheerio.load(html);
  const out: IvreaProxima[] = [];
  let currentDate: string | null = null;

  // h2 (lanzamientos + banners de fecha) y h3.aio-icon-title (reediciones), en
  // orden de documento, para arrastrar bien la fecha del banner vigente.
  $("h2, h3.aio-icon-title").each((_, h) => {
    const text = $(h).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    const tag = (h as { tagName?: string }).tagName?.toLowerCase();
    const volM = text.match(/#\s*(\d{1,4})/);
    const title = text.split("#")[0].trim() || text;

    if (tag === "h3") {
      // Reedición.
      const href = $(h).closest("a").attr("href") || "";
      out.push({
        slug: href.match(/\/titulo\/([^/]+)\//)?.[1] ?? null,
        title,
        volume: volM ? Number(volM[1]) : null,
        isNewSeries: false,
        isLastVolume: false,
        isOneShot: false,
        isReissue: true,
        releaseDate: currentDate,
        coverImage: $(h).closest(".aio-icon-box").find("img").attr("src") ?? null,
      });
      return;
    }

    const col = $(h).closest(".vc_col-sm-2");
    if (col.length === 0) {
      // h2 fuera de una tarjeta → puede ser un banner de fecha de sección.
      const d = parseIvreaBanner(text);
      if (d) currentDate = d;
      return;
    }
    // h2 dentro de una tarjeta = lanzamiento normal.
    const sub = col.find(".uvc-sub-heading").text();
    const href =
      col.find("a.ubtn-link").attr("href") ||
      col.find("a[href*='/titulo/']").attr("href") ||
      "";
    out.push({
      slug: href.match(/\/titulo\/([^/]+)\//)?.[1] ?? null,
      title,
      volume: volM ? Number(volM[1]) : null,
      isNewSeries: /NUEVA SERIE/i.test(sub),
      isLastVolume: /[ÚU]LTIMO TOMO/i.test(sub),
      isOneShot: /TOMO [ÚU]NICO/i.test(sub),
      isReissue: false,
      releaseDate: currentDate,
      coverImage: col.find("img.vc_single_image-img").attr("src") ?? null,
    });
  });
  return out;
}

export interface IvreaNewsItem {
  title: string;
  author: string | null;
  releaseLabel: string | null; // "YYYY-MM" del mes anunciado
  totalVolumes: number | null; // "Serie de N tomos"
  coverImage: string | null;
}

/**
 * Series NUEVAS anunciadas en ivrea.com.ar/news/ ("Próximos lanzamientos").
 * Son debuts que todavía no tienen ficha /titulo/ (por eso no salen del catálogo
 * normal). Cada tarjeta trae mes+año, autor ("DE …"), "Serie de N tomos" y
 * portada. Es la fuente de las "próximas series".
 */
const NEWS_KEY = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

const cleanAuthor = (raw: string | undefined | null): string | null => {
  const a = raw
    ?.replace(/&amp;/g, "&")
    .replace(/\s+y\s+/gi, ", ")
    .replace(/\s*&\s*/g, ", ")
    .trim();
  if (!a || a.length > 50 || /\d/.test(a)) return null;
  // Title-case de nombres en MAYÚSCULAS.
  return a.replace(/\b([A-ZÁÉÍÓÚÑ])([A-ZÁÉÍÓÚÑ]+)/g, (_, x, y) => x + y.toLowerCase());
};

/**
 * Series NUEVAS anunciadas en ivrea.com.ar/news/ ("Próximos lanzamientos"):
 * debuts que todavía no tienen ficha /titulo/. La página mezcla DOS layouts:
 *  - tarjetas (imagen + h2/h3 + subtítulo) → traen portada;
 *  - bloques de texto "Mes Año TÍTULO de Autor …" (destacados) → sin tarjeta.
 * Hacemos las dos pasadas y mergeamos por título. La portada que falte se
 * completa después desde /proximas/ (que sí la tiene para las inminentes).
 */
export async function getIvreaNews(): Promise<IvreaNewsItem[]> {
  const response = await fetch(`${BASE}/news/`, { next: { revalidate: 60 * 60 * 6 } });
  if (!response.ok) return [];
  const html = await response.text();
  const $ = cheerio.load(html);
  const byKey = new Map<string, IvreaNewsItem>();

  // Pasada 1 — tarjetas con imagen.
  $("h1, h2, h3").each((_, h) => {
    const title = $(h).text().replace(/\s+/g, " ").trim();
    if (!title || /PR[ÓO]XIMOS LANZAMIENTOS/i.test(title)) return;
    const card = $(h).closest(".vc_col-sm-2, .vc_column-inner, .wpb_column");
    if (!card.length) return;
    const rest = card.text().replace(/\s+/g, " ").trim().split(title).join(" · ");
    const dm = rest
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})(?!\d)/);
    if (!dm) return;
    const month = IVREA_MONTHS[dm[1]];
    const vols = rest.match(/Serie de (\d+) tomos/i)?.[1];
    byKey.set(NEWS_KEY(title), {
      title,
      author: cleanAuthor(rest.match(/\bDE\s+(.+?)\s+(?:Serie de|Formato|Tomo|Recopila|Incluye|Edici[óo]n)/i)?.[1]),
      releaseLabel: month ? `${dm[2]}-${String(month).padStart(2, "0")}` : null,
      totalVolumes: vols ? Number(vols) : null,
      coverImage: $(h).closest(".vc_row.wpb_row").find("img").first().attr("src") || null,
    });
  });

  return [...byKey.values()];
}

// --- helpers ---------------------------------------------------------------

function isTitlePage(response: Response): boolean {
  // Un slug inexistente redirige al home; una ficha real mantiene /titulo/.
  return !response.redirected && response.url.includes("/titulo/");
}

const STATUS = "([A-Za-zÁÉÍÓÚáéíóú ]+?)";
// Separador entre el estado y la cantidad: guion ("– 107 TOMOS") o paréntesis
// de apertura ("(40 TOMOS)"), según la ficha.
const SEP = "\\s*(?:[-–—]|\\()\\s*";

/**
 * Extrae los tomos publicados en Argentina cubriendo los layouts de Ivrea:
 *   1. "ESTADO EN ARGENTINA: EN CURSO – 107 TOMOS"   (fichas nuevas)
 *   2. "ESTADO: COMPLETA – 74 TOMOS"                 (fichas viejas)
 *   3. "ESTADO: COMPLETA (40 TOMOS)"                 (variante con paréntesis)
 *   4. "SERIE DE: 11 TOMOS"                          (kanzenban/recopilatorios)
 */
function parseArgentina(text: string): { status: string; volumes: number } {
  // 1) Layout nuevo, explícito para Argentina.
  const ar = text.match(
    new RegExp(`ESTADO EN ARGENTINA:?\\s*${STATUS}${SEP}(\\d+)\\s*TOMOS`, "i"),
  );
  if (ar) return { status: ar[1].trim().toUpperCase(), volumes: Number(ar[2]) };

  // 2) Layout viejo con "ESTADO:" (colon inmediato). Puede haber varias
  //    ediciones; nos quedamos con la de más tomos (serie completa).
  const generic = [
    ...text.matchAll(new RegExp(`ESTADO:\\s*${STATUS}${SEP}(\\d+)\\s*TOMOS`, "gi")),
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
    `ESTADO EN JAP[ÓO]N:?\\s*${STATUS}${SEP}(\\d+)\\s*TOMOS`,
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
