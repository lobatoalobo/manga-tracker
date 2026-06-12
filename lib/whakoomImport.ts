import { getWhakoomEdition, mapWhakoomPublisher } from "./providers/whakoom";
import { resolveByTitleAuthor } from "./resolveSeries";
import { upsertPublisherEdition, slugifyTitle } from "./catalog";
import { prisma } from "./prisma";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Enumera todas las URLs de edición de una página de editorial de Whakoom
 * (la vista `/publisher/<id>/<slug>/all`). Es pública y pagina con `?_p=N`
 * (server-side, sin login ni AJAX), así que recorremos páginas hasta que no
 * traiga ediciones nuevas.
 */
export async function enumeratePublisherEditions(
  allUrl: string,
  opts: {
    maxPages?: number;
    throttleMs?: number;
    onPage?: (page: number, total: number) => void;
  } = {},
): Promise<string[]> {
  const maxPages = opts.maxPages ?? 300;
  const throttle = opts.throttleMs ?? 500;
  const base = allUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");

  const urls = new Set<string>();
  for (let p = 1; p <= maxPages; p++) {
    const html = await fetch(`${base}?_p=${p}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");

    const paths = [
      ...new Set(
        [...html.matchAll(/href="(\/ediciones\/\d+\/[^"]+)"/g)].map((m) => m[1]),
      ),
    ];
    if (paths.length === 0) break;

    let added = 0;
    for (const path of paths) {
      const full = `https://www.whakoom.com${path}`;
      if (!urls.has(full)) {
        urls.add(full);
        added++;
      }
    }
    opts.onPage?.(p, urls.size);
    if (added === 0) break; // dejó de traer nuevas → llegamos al final
    await sleep(throttle);
  }
  return [...urls];
}

export interface ImportResult {
  processed: number;
  imported: number;
  mapped: number;
  skipped: string[];
}

/**
 * Importa ediciones nacionales desde URLs de Whakoom (/ediciones/<id>/…). Por
 * cada una lee la página pública (título + autor + tomos + editorial), la mapea
 * a AniList verificando por autor, y la guarda en el catálogo (PublisherEdition).
 */
export async function importWhakoomUrls(
  urls: string[],
  opts: {
    throttleMs?: number;
    onProgress?: (p: { done: number; total: number; mapped: number }) => void;
  } = {},
): Promise<ImportResult> {
  const throttle = opts.throttleMs ?? 700;
  const clean = [
    ...new Set(
      urls
        .map((u) => u.trim())
        .filter((u) => /whakoom\.com\/ediciones\//i.test(u)),
    ),
  ];

  const res: ImportResult = { processed: 0, imported: 0, mapped: 0, skipped: [] };

  for (const url of clean) {
    res.processed++;

    const ed = await getWhakoomEdition(url).catch(() => null);
    if (!ed) {
      res.skipped.push(`${url} — no se pudo leer`);
      await sleep(throttle);
      continue;
    }

    const publisher = mapWhakoomPublisher(ed.publisher);
    if (!publisher) {
      res.skipped.push(`${url} — editorial no soportada (${ed.publisher})`);
      await sleep(throttle);
      continue;
    }

    // Solo guardamos lo que mapea a AniList (verificado por autor): eso filtra a
    // manga (AniList es solo manga) y descarta cómics Marvel/DC y homónimos.
    const anilistId = await resolveByTitleAuthor(ed.title, ed.author).catch(
      () => null,
    );
    if (!anilistId) {
      res.skipped.push(`${url} — no mapeó a AniList (${ed.title})`);
      await sleep(throttle);
      continue;
    }

    const slug = slugifyTitle(ed.title);
    await upsertPublisherEdition({
      publisher,
      slug,
      title: ed.title,
      volumes: ed.volumes,
      status: "EN CATÁLOGO",
      url,
    });
    await prisma.publisherEdition
      .updateMany({ where: { publisher, slug }, data: { anilistId } })
      .catch(() => {});

    res.imported++;
    res.mapped++;
    opts.onProgress?.({ done: res.processed, total: clean.length, mapped: res.mapped });
    await sleep(throttle);
  }

  return res;
}
