import * as cheerio from "cheerio";
import { getIvreaDataBySlug } from "@/lib/providers/ivrea";
import {
  upsertPublisherEdition,
  findOrCreateWork,
  normalizeTitle,
} from "@/lib/catalog";
import { getRejected } from "@/lib/rejectedSources";
import { prisma } from "@/lib/prisma";

const UA = { "User-Agent": "Mozilla/5.0" };

function humanize(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Procesa `items` con concurrencia acotada. */
async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        await fn(items[idx]);
      } catch {
        /* seguimos */
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}

export interface IvreaCatalogResult {
  catalog: number; // títulos en /catalogo/
  saved: number; // ediciones indexadas (con tomos)
}

/**
 * Crawl del catálogo de Ivrea (ivrea.com.ar/catalogo/): por cada título trae la
 * ficha y upsertea la edición "Ivrea Argentina" (tomos/estado/url) + completa el
 * Work (autor/sinopsis/portada/romaji). Idempotente; respeta la skip-list.
 *
 * Ivrea NO bloquea el datacenter, así que corre en Vercel (cron). Esto desacopla
 * la frescura de Ivrea de la PC local (solo Whakoom necesita correr local).
 */
export async function crawlIvreaCatalog(): Promise<IvreaCatalogResult> {
  // Retry del catálogo: la red/IP a veces falla y no queremos abortar todo.
  let html = "";
  for (let a = 0; a < 3 && !html; a++) {
    try {
      const r = await fetch("https://www.ivrea.com.ar/catalogo/", { headers: UA });
      if (r.ok) html = await r.text();
    } catch {
      /* reintenta */
    }
    if (!html) await new Promise((res) => setTimeout(res, 2000));
  }
  if (!html) return { catalog: 0, saved: 0 };

  const $ = cheerio.load(html);
  const titles = new Map<string, string>(); // slug → title
  $("a[href*='/titulo/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/titulo\/([^/]+)\//);
    if (m) {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (!titles.has(m[1]) || text) titles.set(m[1], text || humanize(m[1]));
    }
  });

  const rejected = await getRejected("ivrea");
  const entries = [...titles.entries()].filter(([slug]) => !rejected.has(slug));

  let saved = 0;
  await pool(entries, 6, async ([slug, title]) => {
    const d = await getIvreaDataBySlug(slug);
    if (!d || d.argentinaVolumes <= 0) return;
    const t = d.title || title;
    const norm = normalizeTitle(t);
    // Anti-duplicado: si Ivrea cambió el slug, actualizamos la edición existente
    // (mismo normTitle, otro slug) en vez de crear un duplicado huérfano.
    const dup = await prisma.publisherEdition.findFirst({
      where: { publisher: "Ivrea Argentina", normTitle: norm, slug: { not: slug } },
      select: { id: true },
    });
    if (dup) {
      await prisma.publisherEdition
        .update({
          where: { id: dup.id },
          data: {
            title: t,
            normTitle: norm,
            slug,
            url: d.url,
            volumes: d.argentinaVolumes,
            status: d.argentinaStatus,
          },
        })
        .catch(() => {});
    } else {
      await upsertPublisherEdition({
        publisher: "Ivrea Argentina",
        slug,
        title: t,
        volumes: d.argentinaVolumes,
        status: d.argentinaStatus,
        url: d.url,
      });
    }
    const row = await prisma.publisherEdition.findUnique({
      where: { publisher_slug: { publisher: "Ivrea Argentina", slug } },
      select: { id: true, workId: true },
    });
    if (row) {
      const workId = await findOrCreateWork({
        title: t,
        coverImage: d.coverImage,
        author: d.author,
        synopsis: d.synopsis,
        originalTitle: d.originalTitle,
      }).catch(() => null);
      if (workId && row.workId !== workId)
        await prisma.publisherEdition
          .update({ where: { id: row.id }, data: { workId } })
          .catch(() => {});
    }
    saved++;
  });

  return { catalog: entries.length, saved };
}
