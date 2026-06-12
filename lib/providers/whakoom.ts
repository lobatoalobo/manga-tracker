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

  const t = await r.text();

  const title = (
    t.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
    t.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
    ""
  )
    .replace(/\s*\([^)]*\)\s*$/, "") // saca "(Editorial)" del final si está
    .trim();
  if (!title) return null;

  const author =
    [...t.matchAll(/href="\/autores\/[^"]+"[^>]*>([^<]+)</g)].map((m) =>
      m[1].trim(),
    )[0] ?? null;

  const publisher =
    [...t.matchAll(/href="\/publisher\/[^"]+"[^>]*>([^<]+)</g)].map((m) =>
      m[1].trim(),
    )[0] ?? "";

  const issues = [
    ...t.matchAll(/\/comics\/[A-Za-z0-9]+\/[^"/]+\/(\d+)"/g),
  ].map((m) => Number(m[1]));
  const volumes = issues.length ? Math.max(...issues) : 0;

  return { title, author, publisher, volumes, url };
}
