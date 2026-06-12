export interface WhakoomEdition {
  title: string;
  author: string | null;
  publisher: string; // editorial tal como la lista Whakoom
  volumes: number;
  url: string;
}

/** Mapea la editorial de Whakoom a nuestras editoriales argentinas (o null). */
export function mapWhakoomPublisher(whakoomPublisher: string): string | null {
  const p = whakoomPublisher.toLowerCase();
  if (p.includes("panini") && p.includes("argentina")) return "Panini Argentina";
  if (p.includes("ivrea")) return "Ivrea Argentina";
  if (p.includes("ovni")) return "Ovni Press";
  return null;
}

/**
 * Lee una página pública de edición de Whakoom (/ediciones/<id>/…) y extrae
 * título, autor, editorial y cantidad de tomos. Las páginas de edición son
 * públicas (a diferencia del buscador), así que no requiere login.
 */
export async function getWhakoomEdition(
  url: string,
): Promise<WhakoomEdition | null> {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).catch(() => null);
  if (!r || !r.ok) return null;

  return parseWhakoomEdition(await r.text(), url);
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

  // Cada tomo es un link /comics/<id>/<slug>[/<n>]. Las ediciones de varios
  // tomos numeran el último segmento; las de 1 tomo no lo tienen. Tomamos el
  // número más alto, o contamos los comics distintos si no hay numeración.
  const issues = [
    ...t.matchAll(/\/comics\/[A-Za-z0-9]+\/[^"/]+\/(\d+)/g),
  ].map((m) => Number(m[1]));
  const comicIds = new Set(
    [...t.matchAll(/\/comics\/([A-Za-z0-9]+)\//g)].map((m) => m[1]),
  );
  const volumes = issues.length ? Math.max(...issues) : comicIds.size || 0;

  return { title, author, publisher, volumes, url };
}
