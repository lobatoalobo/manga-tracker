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
import { prisma } from "./prisma";

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
  whakoomId: string | null;
  volumesList: WhakoomVolume[];
}) {
  const row = await prisma.publisherEdition.findUnique({
    where: { publisher_slug: { publisher: opts.publisher, slug: opts.slug } },
    select: { id: true },
  });
  if (!row) return;

  const workId = await findOrCreateWork({
    title: opts.title,
    anilistId: opts.anilistId,
    coverImage: opts.cover,
    author: opts.author,
    synopsis: opts.synopsis,
  }).catch(() => null);

  const data: { whakoomId?: string; workId?: number } = {};
  if (opts.whakoomId) data.whakoomId = opts.whakoomId;
  if (workId) data.workId = workId;
  if (Object.keys(data).length)
    await prisma.publisherEdition
      .update({ where: { id: row.id }, data })
      .catch(() => {});

  // Preventa: NADA publicado todavía (0 tomos tras excluir los not-published) y
  // fecha de salida futura → marcamos la obra "próximo a salir" (badge Pronto).
  // El release real lo detecta el flujo 0→1 (cuando sale el 1er tomo), no el
  // calendario: así un atraso no dispara "¡Ya salió!" antes de tiempo.
  if (
    workId &&
    opts.volumes === 0 &&
    opts.releaseDate != null &&
    opts.releaseDate.getTime() > Date.now()
  )
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
