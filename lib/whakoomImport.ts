import {
  getWhakoomEdition,
  fetchWhakoomHtml,
  mapWhakoomPublisher,
  type WhakoomVolume,
} from "./providers/whakoom";
import { resolveByTitleAuthor } from "./resolveSeries";
import {
  upsertPublisherEdition,
  slugifyTitle,
  findOrCreateWork,
} from "./catalog";
import { ovniSearchUrl } from "./ovni";
import { looksLikeComic } from "./contentType";
import { getRejected, whakoomIdFromUrl } from "./rejectedSources";
import { prisma } from "./prisma";
import { storeCover } from "./coverStore";
import { isCurated } from "@/lib/domain/work/curated";

/**
 * Portada del TOMO 1 (anti-spoiler): el og:image de la edición de Whakoom suele
 * ser un tomo adelantado. Sacamos la del comic del tomo 1. null si no se puede.
 */
async function tomo1CoverUrl(volumesList: WhakoomVolume[]): Promise<string | null> {
  const c = volumesList.find((v) => v.number === 1)?.comicId;
  if (!c) return null;
  const r = await fetchWhakoomHtml(`https://www.whakoom.com/comics/${c}`);
  return r.ok ? (r.html.match(/og:image" content="([^"]+)"/i)?.[1]?.trim() ?? null) : null;
}

/**
 * Slug destino para una edición de Whakoom. Si ya existe una fila de esta misma
 * editorial con este `whakoomId`, devolvemos SU slug para actualizarla (dedup):
 * así reimportar la misma edición —aunque el título haya cambiado un poco— no
 * crea un duplicado. Si no, slug nuevo desde el título.
 */
async function targetSlug(
  publisher: string,
  title: string,
  whakoomId: string | null,
): Promise<string> {
  if (whakoomId) {
    const existing = await prisma.publisherEdition.findUnique({
      where: { whakoomId },
      select: { publisher: true, slug: true },
    });
    if (existing && existing.publisher === publisher) return existing.slug;
  }
  return slugifyTitle(title);
}

/**
 * Sobre una fila de PublisherEdition ya creada, guarda: el id de Whakoom, la obra
 * del catálogo local (workId, agrupando por anilistId/título), y los tomos
 * individuales. Best-effort: si el whakoomId choca con otra fila lo ignoramos.
 */
async function persistEditionIdentity(opts: {
  publisher: string;
  slug: string;
  title: string;
  anilistId: number | null;
  cover: string | null;
  author: string | null;
  synopsis: string | null;
  volumes: number;
  releaseDate: Date | null;
  hasUnreleased: boolean;
  whakoomId: string | null;
  volumesList: WhakoomVolume[];
}) {
  const row = await prisma.publisherEdition.findUnique({
    where: { publisher_slug: { publisher: opts.publisher, slug: opts.slug } },
    select: { id: true },
  });
  if (!row) return;

  // OJO: NO guardamos releaseDate desde Whakoom. Su "Fecha de publicación" es la
  // fecha PASADA del tomo, no un lanzamiento futuro → inútil para "sale en X". La
  // fecha de salida es MANUAL (editor). Acá solo la usamos para detectar preventa.
  // NO le pasamos la portada de la edición (suele ser un tomo adelantado/spoiler):
  // la resolvemos abajo, priorizando la del tomo 1.
  const workId = await findOrCreateWork({
    title: opts.title,
    anilistId: opts.anilistId,
    author: opts.author,
    synopsis: opts.synopsis,
    // Whakoom/Panini mezcla manga y cómic → clasificamos por título/autor (misma
    // heurística que setea Work.type) para no fusionar cross-type (guard).
    incomingType: looksLikeComic(opts.title, opts.author) ? "COMIC" : "MANGA",
  }).catch(() => null);

  // Portada = TOMO 1, SOLO si el work no tiene portada todavía (no re-fetcheamos
  // para los existentes → no penaliza el crawl). Respeta lo curado a mano.
  if (workId) {
    const w = await prisma.work
      .findUnique({ where: { id: workId }, select: { coverImage: true, curated: true } })
      .catch(() => null);
    if (w && !w.coverImage && !isCurated(w.curated, "coverImage")) {
      const t1 = (await tomo1CoverUrl(opts.volumesList).catch(() => null)) ?? opts.cover;
      const cover = t1 ? await storeCover(t1).catch(() => null) : null;
      if (cover)
        await prisma.work.update({ where: { id: workId }, data: { coverImage: cover } }).catch(() => {});
    }
  }

  const data: { whakoomId?: string; workId?: number } = {};
  if (opts.whakoomId) data.whakoomId = opts.whakoomId;
  if (workId) data.workId = workId;
  if (Object.keys(data).length)
    await prisma.publisherEdition
      .update({ where: { id: row.id }, data })
      .catch(() => {});

  // "Próximo a salir" (badge Pronto) en dos casos:
  //  - PREVENTA: nada publicado (0 tomos tras excluir not-published) + fecha futura.
  //  - EN CURSO con TOMO NUEVO anunciado: hay un tomo not-published (aunque haya
  //    tomos publicados).
  // Es aditivo (solo marca true): cuando el tomo sale, el conteo sube y el flujo
  // de "¡Ya salió!" (catalogNotify) lo desmarca solo. Así un atraso no rompe nada
  // ni pisamos un flag manual.
  const isPreorder =
    opts.volumes === 0 &&
    opts.releaseDate != null &&
    opts.releaseDate.getTime() > Date.now();
  if (workId && (isPreorder || opts.hasUnreleased))
    await prisma.work
      .update({ where: { id: workId }, data: { upcoming: true } })
      .catch(() => {});

  for (const v of opts.volumesList) {
    if (!Number.isFinite(v.number) || v.number <= 0) continue;
    await prisma.volume
      .upsert({
        where: { editionId_number: { editionId: row.id, number: v.number } },
        update: { whakoomComicId: v.comicId },
        create: { editionId: row.id, number: v.number, whakoomComicId: v.comicId },
      })
      .catch(() => {});
  }
}

export interface SingleImportResult {
  ok: boolean;
  error?: string;
  title?: string;
  publisher?: string;
  anilistId?: number | null;
  editionId?: number;
}

/**
 * Importa UNA edición desde una URL de Whakoom (uso manual del admin). A
 * diferencia del import masivo, guarda la edición **aunque no mapee** a AniList
 * (queda "sin mapear" para curar en /admin/mapeos). Sirve para traer preventas
 * y títulos en español que Whakoom tiene y nuestro crawl todavía no.
 */
export async function importWhakoomUrl(
  url: string,
): Promise<SingleImportResult> {
  if (!/whakoom\.com\/ediciones\//i.test(url))
    return { ok: false, error: "No parece una URL de edición de Whakoom." };

  // getWhakoomEdition trae la lista COMPLETA de tomos (vía /todos). Si falla,
  // sondeamos el fetch para dar un motivo claro (bloqueo vs parseo).
  const ed = await getWhakoomEdition(url).catch(() => null);
  if (!ed) {
    const probe = await fetchWhakoomHtml(url);
    return {
      ok: false,
      error: probe.ok
        ? "Se leyó la página pero no se pudo parsear."
        : `No se pudo leer la página de Whakoom (${probe.reason}). Si dice HTTP 403/503, Whakoom está bloqueando el server; usá el script de import local.`,
    };
  }

  const publisher = mapWhakoomPublisher(ed.publisher);
  if (!publisher)
    return { ok: false, error: `Editorial no soportada (${ed.publisher || "—"}).` };

  const anilistId = await resolveByTitleAuthor(ed.title, ed.author).catch(
    () => null,
  );
  const slug = await targetSlug(publisher, ed.title, ed.whakoomId);
  const storeUrl = publisher === "Ovni Press" ? ovniSearchUrl(ed.title) : url;

  await upsertPublisherEdition({
    publisher,
    slug,
    title: ed.title,
    volumes: ed.volumes,
    status: "EN CATÁLOGO",
    url: storeUrl,
  });
  if (anilistId)
    await prisma.publisherEdition
      .updateMany({ where: { publisher, slug }, data: { anilistId } })
      .catch(() => {});

  await persistEditionIdentity({
    publisher,
    slug,
    title: ed.title,
    anilistId,
    cover: ed.cover,
    author: ed.author,
    synopsis: ed.synopsis,
    volumes: ed.volumes,
    releaseDate: ed.releaseDate,
    hasUnreleased: ed.hasUnreleased,
    whakoomId: ed.whakoomId,
    volumesList: ed.volumesList,
  });

  const row = await prisma.publisherEdition.findUnique({
    where: { publisher_slug: { publisher, slug } },
    select: { id: true },
  });

  return { ok: true, title: ed.title, publisher, anilistId, editionId: row?.id };
}

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
    const res = await fetchWhakoomHtml(`${base}?_p=${p}`);
    const html = res.ok ? res.html : "";

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
    // Si es false, no consulta AniList (más rápido y sin depender de su API):
    // el seed bulk lo deja en null y el mapeo se hace después como enriquecimiento.
    resolveAnilist?: boolean;
    // Incremental: saltea las ediciones cuyo whakoomId YA tenemos (solo trae las
    // nuevas). Acelera el refresh; no detecta tomos nuevos en las existentes.
    skipExisting?: boolean;
    onProgress?: (p: { done: number; total: number; mapped: number }) => void;
  } = {},
): Promise<ImportResult> {
  const throttle = opts.throttleMs ?? 700;
  const resolveAnilist = opts.resolveAnilist !== false;
  const clean = [
    ...new Set(
      urls
        .map((u) => u.trim())
        .filter((u) => /whakoom\.com\/ediciones\//i.test(u)),
    ),
  ];

  // Saltear las descartadas a mano (no re-importar lo que ya curaste/borraste).
  const rejected = await getRejected("whakoom");
  // Incremental: set de whakoomIds que ya tenemos (para traer solo lo nuevo).
  const existing = opts.skipExisting
    ? new Set(
        (
          await prisma.publisherEdition.findMany({
            where: { whakoomId: { not: null } },
            select: { whakoomId: true },
          })
        ).map((e) => e.whakoomId as string),
      )
    : null;

  const res: ImportResult = { processed: 0, imported: 0, mapped: 0, skipped: [] };

  for (const url of clean) {
    res.processed++;
    const wId = whakoomIdFromUrl(url);
    if (wId && rejected.has(wId)) {
      res.skipped.push(`${url} — descartada (rejected)`);
      continue;
    }
    if (existing && wId && existing.has(wId)) continue; // ya la tenemos

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

    // Mapeo a AniList opcional (referencia/enriquecimiento): ya NO descartamos
    // lo que no mapea. El catálogo es local; AniList es solo una referencia. Esto
    // arregla que el import masivo tiraba la mayoría de las series (AniList no las
    // tiene o con otro título).
    const anilistId = resolveAnilist
      ? await resolveByTitleAuthor(ed.title, ed.author).catch(() => null)
      : null;

    const slug = await targetSlug(publisher, ed.title, ed.whakoomId);
    // Para Ovni guardamos un link a OvniPress (no a Whakoom, que es solo la
    // fuente del import); para el resto, la URL de la edición.
    const storeUrl =
      publisher === "Ovni Press" ? ovniSearchUrl(ed.title) : url;
    await upsertPublisherEdition({
      publisher,
      slug,
      title: ed.title,
      volumes: ed.volumes,
      status: "EN CATÁLOGO",
      url: storeUrl,
    });
    if (anilistId)
      await prisma.publisherEdition
        .updateMany({ where: { publisher, slug }, data: { anilistId } })
        .catch(() => {});

    await persistEditionIdentity({
      publisher,
      slug,
      title: ed.title,
      anilistId,
      cover: ed.cover,
      author: ed.author,
      synopsis: ed.synopsis,
      volumes: ed.volumes,
      releaseDate: ed.releaseDate,
    hasUnreleased: ed.hasUnreleased,
      whakoomId: ed.whakoomId,
      volumesList: ed.volumesList,
    });

    res.imported++;
    if (anilistId) res.mapped++;
    opts.onProgress?.({ done: res.processed, total: clean.length, mapped: res.mapped });
    await sleep(throttle);
  }

  return res;
}
