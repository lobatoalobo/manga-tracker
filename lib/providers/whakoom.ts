export interface WhakoomVolume {
  number: number;
  comicId: string; // id del tomo en Whakoom (/comics/<id>/…)
}

export interface WhakoomEdition {
  title: string;
  author: string | null;
  publisher: string; // editorial tal como la lista Whakoom
  volumes: number;
  url: string;
  cover: string | null; // portada (og:image)
  synopsis: string | null; // "Argumento" de la ficha (para obras no-AniList)
  releaseDate: Date | null; // "Fecha de publicación" (futura = preventa → "Pronto")
  whakoomId: string | null; // id de la edición (/ediciones/<id>/…)
  volumesList: WhakoomVolume[]; // tomos individuales con su id de Whakoom
}

/** Decodifica entidades HTML (numéricas y las comunes con nombre). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/**
 * Parsea la "Fecha de publicación" de Whakoom ("Julio 2026", "2026", "15 de
 * julio de 2026") al primer día de ese mes. Granularidad de mes (Whakoom no da
 * día en preventas). Devuelve null si no la entiende.
 */
export function parseWhakoomDate(label: string): Date | null {
  const t = decodeEntities(label)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  const ym = t.match(/([a-z]+)\s+(\d{4})/); // "julio 2026"
  if (ym && ym[1] in MONTHS) return new Date(Number(ym[2]), MONTHS[ym[1]], 1);
  const yOnly = t.match(/\b(\d{4})\b/); // "2026" suelto → enero de ese año
  if (yOnly) return new Date(Number(yOnly[1]), 0, 1);
  return null;
}

/** Mapea la editorial de Whakoom a nuestras editoriales argentinas (o null). */
export function mapWhakoomPublisher(whakoomPublisher: string): string | null {
  // Normalizamos tildes: la editorial puede venir "Planeta Cómic" (con tilde) y
  // los checks usan ASCII ("comic").
  const p = whakoomPublisher
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (p.includes("panini") && p.includes("argentina")) return "Panini Argentina";
  if (p.includes("ivrea")) return "Ivrea Argentina";
  if (p.includes("ovni")) return "Ovni Press";
  if (p.includes("kemuri")) return "Kemuri Ediciones";
  if (p.includes("utopia")) return "Utopía Editorial";
  if (p.includes("larp")) return "Larp Editores";
  if (p.includes("distrito") && p.includes("manga")) return "Distrito Manga";
  // "Planeta Cómic" (no los regionales "Planeta Cómic México/Chile").
  if (p.includes("planeta") && p.includes("comic") && !/m[eé]xico|chile/.test(p))
    return "Planeta Cómic";
  return null;
}

// Headers de navegador completos: Whakoom (Cloudflare) puede rechazar fetches
// "pelados" desde IPs de datacenter si falta Accept/Accept-Language/UA real.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch crudo de una página de Whakoom, reportando el motivo de falla (status
 * HTTP o error de red). Reintenta una vez ante rate-limit (429/503), que pasa
 * al pedir varias páginas seguidas.
 */
export async function fetchWhakoomHtml(
  url: string,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: BROWSER_HEADERS }).catch(
      (e) => ({ _err: e instanceof Error ? e.message : "error de red" }) as const,
    );
    if ("_err" in r) {
      if (attempt === 0) {
        await sleep(1500);
        continue;
      }
      return { ok: false, reason: `red: ${r._err}` };
    }
    if (r.status === 429 || r.status === 503) {
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      return { ok: false, reason: `HTTP ${r.status}` };
    }
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    return { ok: true, html: await r.text() };
  }
  return { ok: false, reason: "rate-limit" };
}

/**
 * Extrae la lista de tomos de un HTML de Whakoom. Cada tomo es un link
 * /comics/<id>/<slug>[/<n>]: si están numerados, uno por número (deduplicado);
 * si no, es una edición de 1 tomo. El conteo de tomos = `.length` de esto.
 */
export function parseVolumesList(t: string): WhakoomVolume[] {
  // Tomos anunciados pero NO publicados: Whakoom los marca con la clase
  // "not-published" en su <li>. Están en el listado pero todavía no salieron,
  // así que NO los contamos (si no, el total queda inflado en 1).
  const notPublished = new Set<string>();
  for (const m of t.matchAll(
    /<li[^>]*class="[^"]*not-published[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
  )) {
    const num = m[1].match(/\/comics\/[A-Za-z0-9]+\/[^"/]+\/(\d+)/);
    if (num) notPublished.add(num[1]);
  }

  const numbered = [...t.matchAll(/\/comics\/([A-Za-z0-9]+)\/[^"/]+\/(\d+)/g)];
  const byNumber = new Map<number, string>();
  for (const m of numbered) {
    if (notPublished.has(m[2])) continue;
    const n = Number(m[2]);
    if (!byNumber.has(n)) byNumber.set(n, m[1]);
  }
  if (byNumber.size > 0)
    return [...byNumber.entries()]
      .map(([number, comicId]) => ({ number, comicId }))
      .sort((a, b) => a.number - b.number);

  const only = [...t.matchAll(/\/comics\/([A-Za-z0-9]+)\//g)].map((m) => m[1])[0];
  return only ? [{ number: 1, comicId: only }] : [];
}

/**
 * Lee una página pública de edición de Whakoom (/ediciones/<id>/…) y extrae
 * título, autor, editorial, portada y la lista COMPLETA de tomos.
 *
 * La página de edición trunca los tomos a los últimos (~11); la lista completa
 * vive en la vista `/todos`. Por eso hacemos un segundo fetch a /todos y usamos
 * esa lista para el conteo (si trae más que la página principal).
 */
export async function getWhakoomEdition(
  url: string,
): Promise<WhakoomEdition | null> {
  const r = await fetchWhakoomHtml(url);
  if (!r.ok) return null;
  const ed = parseWhakoomEdition(r.html, url);
  if (!ed) return null;

  const todosUrl =
    url.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/todos";
  await sleep(350); // respiro entre los 2 fetches de la misma edición
  const todos = await fetchWhakoomHtml(todosUrl);
  if (todos.ok) {
    const full = parseVolumesList(todos.html);
    if (full.length > ed.volumesList.length) {
      ed.volumesList = full;
      ed.volumes = full.length;
    }
  }
  return ed;
}

/**
 * Parsea el HTML de una página de edición de Whakoom (sin red). Separado de
 * `getWhakoomEdition` para poder testearlo con fixtures: las páginas mezclan dos
 * formatos (nombre directo en el <a> o anidado en <span itemprop>) y eso ya nos
 * rompió el import una vez.
 */
export function parseWhakoomEdition(
  t: string,
  url: string,
): WhakoomEdition | null {
  const title = (
    t.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
    t.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
    ""
  )
    .replace(/\s*\([^)]*\)\s*$/, "") // saca "(Editorial)" del final si está
    .trim();
  if (!title) return null;

  // El nombre puede venir directo en el <a> o anidado en un <span itemprop>
  // (Whakoom mezcla ambos formatos). Tomamos el contenido del <a> y le sacamos
  // las etiquetas internas.
  const linkText = (hrefPrefix: string): string | null => {
    const m = t.match(
      new RegExp(`href="${hrefPrefix}[^"]+"[^>]*>([\\s\\S]*?)</a>`, "i"),
    );
    if (!m) return null;
    // Decodificamos entidades HTML: el texto del <a> viene crudo, p. ej. la
    // editorial "Planeta C&#243;mic" (ó) o autores con tildes.
    const txt = decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim();
    return txt || null;
  };

  const author = linkText("/autores/");
  const publisher = linkText("/publisher/") ?? "";

  // Lista de tomos. OJO: el conteo es la CANTIDAD de tomos distintos, NO el
  // número más alto (una "edición especial" puede tener los tomos 41 y 42 = 2
  // tomos, no 42). Y la página de edición está truncada a los últimos tomos:
  // la lista completa la trae /todos (ver getWhakoomEdition).
  const volumesList = parseVolumesList(t);
  const volumes = volumesList.length;

  const whakoomId = url.match(/\/ediciones\/(\d+)/)?.[1] ?? null;
  const cover =
    t.match(/<meta property="og:image" content="([^"]+)"/i)?.[1]?.trim() ||
    null;

  // "Argumento" (sinopsis): bloque <div class="wiki-text"><h2>Argumento</h2>…
  // hasta el </div>. Sirve para enriquecer las obras que NO están en AniList.
  const argMatch = t.match(/<h2>\s*Argumento\s*<\/h2>([\s\S]*?)<\/div>/i);
  const synopsis = argMatch
    ? decodeEntities(argMatch[1].replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim() || null
    : null;

  // "Fecha de publicación": si es futura, la obra es preventa → badge "Pronto".
  const dateMatch = t.match(
    /Fecha de publicaci[^<]*<\/h3>\s*<p[^>]*>([^<]+)<\/p>/i,
  );
  const releaseDate = dateMatch ? parseWhakoomDate(dateMatch[1]) : null;

  return {
    title, author, publisher, volumes, url, cover, synopsis, releaseDate,
    whakoomId, volumesList,
  };
}
