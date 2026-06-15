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
  whakoomId: string | null; // id de la edición (/ediciones/<id>/…)
  volumesList: WhakoomVolume[]; // tomos individuales con su id de Whakoom
}

/** Mapea la editorial de Whakoom a nuestras editoriales argentinas (o null). */
export function mapWhakoomPublisher(whakoomPublisher: string): string | null {
  const p = whakoomPublisher.toLowerCase();
  if (p.includes("panini") && p.includes("argentina")) return "Panini Argentina";
  if (p.includes("ivrea")) return "Ivrea Argentina";
  if (p.includes("ovni")) return "Ovni Press";
  if (p.includes("kemuri")) return "Kemuri Ediciones";
  if (p.includes("utopia")) return "Utopía Editorial";
  if (p.includes("larp")) return "Larp Editores";
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
  const numbered = [...t.matchAll(/\/comics\/([A-Za-z0-9]+)\/[^"/]+\/(\d+)/g)];
  const byNumber = new Map<number, string>();
  for (const m of numbered) {
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
    const txt = m[1].replace(/<[^>]+>/g, "").trim();
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

  return { title, author, publisher, volumes, url, cover, whakoomId, volumesList };
}
