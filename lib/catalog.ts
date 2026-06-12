import { prisma } from "@/lib/prisma";

export const PUBLISHERS = [
  "Ivrea Argentina",
  "Panini Argentina",
  "Ovni Press",
] as const;

/** Editoriales para el browse: slug de URL ↔ nombre en el índice + label corto. */
export const EDITORIALS = [
  { slug: "ivrea", publisher: "Ivrea Argentina", label: "Ivrea" },
  { slug: "panini", publisher: "Panini Argentina", label: "Panini" },
  { slug: "ovni", publisher: "Ovni Press", label: "Ovni" },
] as const;

export interface IndexedEdition {
  publisher: string;
  slug: string;
  title: string;
  volumes: number;
  status: string | null;
  url: string;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyTitle(value: string): string {
  return normalizeTitle(value).replace(/ /g, "-");
}

/**
 * Limpia el título de una editorial para buscarlo en AniList. Las editoriales
 * agregan decoraciones que AniList no tiene (subtítulos entre guiones o
 * paréntesis), p. ej. "Aku No Hana -Las Flores Del Mal-" → "Aku No Hana".
 */
export function searchableTitle(value: string): string {
  return value
    // Subtítulo " -Algo-" (con espacio antes; no toca guiones internos como
    // en "Rent-A-Girlfriend" o "Living-Room Matsunaga-San").
    .replace(/\s-[^-]+-(?=\s|$)/g, " ")
    .replace(/\([^)]*\)/g, " ") // "(algo)"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca en el índice las mejores ediciones (una por editorial) que matcheen
 * cualquiera de los títulos dados. Match exacto por slug o título normalizado.
 */
export async function lookupEditions(
  titles: string[],
): Promise<IndexedEdition[]> {
  const slugs = titles.map(slugifyTitle);
  const norms = titles.map(normalizeTitle);

  const rows = await prisma.publisherEdition.findMany({
    where: {
      OR: [{ slug: { in: slugs } }, { normTitle: { in: norms } }],
    },
  });

  // Una por editorial: si hay varias, la de más tomos (edición más completa).
  const best = new Map<string, IndexedEdition>();
  for (const r of rows) {
    const cur = best.get(r.publisher);
    if (!cur || r.volumes > cur.volumes) {
      best.set(r.publisher, {
        publisher: r.publisher,
        slug: r.slug,
        title: r.title,
        volumes: r.volumes,
        status: r.status,
        url: r.url,
      });
    }
  }
  return [...best.values()];
}

interface TitledMedia {
  id: number;
}

/**
 * De una lista de series, cuáles tienen edición nacional, usando el **mapeo
 * verificado** (PublisherEdition.anilistId, resuelto por autor). Devuelve, por
 * id de serie, las editoriales que la publican. Sin matching por título → sin
 * falsos positivos en homónimos.
 */
export async function nationalEditionsByManga(
  mangas: TitledMedia[],
): Promise<Map<number, string[]>> {
  const ids = mangas.map((m) => m.id);
  const result = new Map<number, string[]>();
  if (ids.length === 0) return result;

  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: { in: ids } },
    select: { anilistId: true, publisher: true },
  });

  for (const r of rows) {
    if (r.anilistId == null) continue;
    const pubs = result.get(r.anilistId) ?? [];
    if (!pubs.includes(r.publisher)) pubs.push(r.publisher);
    result.set(r.anilistId, pubs);
  }
  return result;
}

export async function upsertPublisherEdition(e: {
  publisher: string;
  slug: string;
  title: string;
  volumes: number;
  status?: string | null;
  url: string;
}): Promise<void> {
  await prisma.publisherEdition.upsert({
    where: { publisher_slug: { publisher: e.publisher, slug: e.slug } },
    update: {
      title: e.title,
      normTitle: normalizeTitle(e.title),
      volumes: e.volumes,
      status: e.status ?? null,
      url: e.url,
    },
    create: {
      publisher: e.publisher,
      slug: e.slug,
      title: e.title,
      normTitle: normalizeTitle(e.title),
      volumes: e.volumes,
      status: e.status ?? null,
      url: e.url,
    },
  });
}

/**
 * Backfill del id de AniList en las filas del índice ya matcheadas (y verificadas
 * por autor) para una serie. Permite linkear directo desde el browse por
 * editorial a la ficha. Best-effort.
 */
export async function linkPublisherEditions(
  anilistId: number,
  matches: { publisher: string; title: string }[],
): Promise<void> {
  await Promise.all(
    matches.map((m) =>
      prisma.publisherEdition
        .updateMany({
          // Por título normalizado: los slugs en vivo de Panini/Ovni son
          // sintéticos y no matchean los del crawl; el normTitle sí.
          where: { publisher: m.publisher, normTitle: normalizeTitle(m.title) },
          data: { anilistId },
        })
        .catch(() => {}),
    ),
  );
}

export interface EditorialWork {
  id: number;
  title: string;
  anilistId: number | null;
  volumes: number;
  url: string;
}

/** Página del catálogo de una editorial (orden alfabético). */
export async function getEditorialPage(
  publisher: string,
  page: number,
  perPage = 24,
): Promise<{ works: EditorialWork[]; lastPage: number }> {
  const safePage = Math.max(1, page);
  const [total, rows] = await Promise.all([
    prisma.publisherEdition.count({ where: { publisher } }),
    prisma.publisherEdition.findMany({
      where: { publisher },
      orderBy: { normTitle: "asc" },
      skip: (safePage - 1) * perPage,
      take: perPage,
      select: { id: true, title: true, anilistId: true, volumes: true, url: true },
    }),
  ]);
  return { works: rows, lastPage: Math.max(1, Math.ceil(total / perPage)) };
}

/** Todo el catálogo de una editorial (para filtrar/paginar client-side). */
export async function getEditorialAll(
  publisher: string,
): Promise<EditorialWork[]> {
  return prisma.publisherEdition.findMany({
    where: { publisher },
    orderBy: { normTitle: "asc" },
    select: { id: true, title: true, anilistId: true, volumes: true, url: true },
  });
}

// --- Curación admin de mapeos editorial ↔ serie ---

export interface EditionMapping {
  id: number;
  publisher: string;
  title: string;
  slug: string;
  url: string;
  volumes: number;
  anilistId: number | null;
}

export async function getEditionMappings(opts: {
  publisher?: string;
  state?: "mapped" | "unmapped";
  q?: string;
  page?: number;
  perPage?: number;
}): Promise<{ rows: EditionMapping[]; total: number; lastPage: number }> {
  const perPage = opts.perPage ?? 40;
  const page = Math.max(1, opts.page ?? 1);

  const where: {
    publisher?: string;
    anilistId?: { not: null } | null;
    normTitle?: { contains: string };
  } = {};
  if (opts.publisher) where.publisher = opts.publisher;
  if (opts.state === "mapped") where.anilistId = { not: null };
  if (opts.state === "unmapped") where.anilistId = null;
  if (opts.q) where.normTitle = { contains: normalizeTitle(opts.q) };

  const [total, rows] = await Promise.all([
    prisma.publisherEdition.count({ where }),
    prisma.publisherEdition.findMany({
      where,
      orderBy: { normTitle: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        publisher: true,
        title: true,
        slug: true,
        url: true,
        volumes: true,
        anilistId: true,
      },
    }),
  ]);
  return { rows, total, lastPage: Math.max(1, Math.ceil(total / perPage)) };
}

export async function setEditionAnilistId(id: number, anilistId: number | null) {
  await prisma.publisherEdition.update({ where: { id }, data: { anilistId } });
}

/** Edición manual de cualquier campo de una entrada del catálogo. */
export async function updatePublisherEditionFields(
  id: number,
  data: {
    title?: string;
    url?: string;
    volumes?: number;
    anilistId?: number | null;
  },
) {
  const patch: {
    title?: string;
    normTitle?: string;
    url?: string;
    volumes?: number;
    anilistId?: number | null;
  } = {};
  if (data.title !== undefined) {
    patch.title = data.title.trim();
    patch.normTitle = normalizeTitle(data.title);
  }
  if (data.url !== undefined) patch.url = data.url.trim();
  if (data.volumes !== undefined && Number.isFinite(data.volumes))
    patch.volumes = data.volumes;
  if (data.anilistId !== undefined) patch.anilistId = data.anilistId;
  await prisma.publisherEdition.update({ where: { id }, data: patch });
}

export async function deletePublisherEdition(id: number) {
  await prisma.publisherEdition.deleteMany({ where: { id } });
}

/** Cantidad de títulos por editorial (para los chips). */
export async function editorialCounts(): Promise<Record<string, number>> {
  const rows = await prisma.publisherEdition.groupBy({
    by: ["publisher"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.publisher] = r._count._all;
  return out;
}
