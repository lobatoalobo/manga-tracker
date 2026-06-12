import { getWhakoomEdition, mapWhakoomPublisher } from "./providers/whakoom";
import { resolveByTitleAuthor } from "./resolveSeries";
import { upsertPublisherEdition, slugifyTitle } from "./catalog";
import { prisma } from "./prisma";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    const slug = slugifyTitle(ed.title);
    await upsertPublisherEdition({
      publisher,
      slug,
      title: ed.title,
      volumes: ed.volumes,
      status: "EN CATÁLOGO",
      url,
    });

    const anilistId = await resolveByTitleAuthor(ed.title, ed.author).catch(
      () => null,
    );
    if (anilistId) {
      await prisma.publisherEdition
        .updateMany({ where: { publisher, slug }, data: { anilistId } })
        .catch(() => {});
      res.mapped++;
    }

    res.imported++;
    opts.onProgress?.({ done: res.processed, total: clean.length, mapped: res.mapped });
    await sleep(throttle);
  }

  return res;
}
