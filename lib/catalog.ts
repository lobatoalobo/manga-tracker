import { prisma } from "@/lib/prisma";
import { looksLikeComic } from "@/lib/comicTerms";

export const PUBLISHERS = [
  "Ivrea Argentina",
  "Panini Argentina",
  "Ovni Press",
  "Kemuri Ediciones",
  "Utopía Editorial",
  "Larp Editores",
  "Distrito Manga",
  "Planeta Cómic",
] as const;

/** Editoriales para el browse: slug de URL ↔ nombre en el índice + label corto. */
export const EDITORIALS = [
  { slug: "ivrea", publisher: "Ivrea Argentina", label: "Ivrea" },
  { slug: "panini", publisher: "Panini Argentina", label: "Panini" },
  { slug: "ovni", publisher: "Ovni Press", label: "Ovni" },
  { slug: "kemuri", publisher: "Kemuri Ediciones", label: "Kemuri" },
  { slug: "utopia", publisher: "Utopía Editorial", label: "Utopía" },
  { slug: "larp", publisher: "Larp Editores", label: "Larp" },
  { slug: "distrito", publisher: "Distrito Manga", label: "Distrito" },
  { slug: "planeta", publisher: "Planeta Cómic", label: "Planeta" },
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
 * Llave ESTRICTA de título para agrupar obras: como normalizeTitle pero preserva
 * "+" y números, para NO fusionar homónimos que se distinguen justo por eso
 * (Citrus vs Citrus+, Rayearth vs Rayearth II). normalizeTitle los aplasta igual.
 */
export function tightTitleKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export interface LocalCatalogHit {
  id: number;
  publisher: string;
  title: string;
  anilistId: number | null;
  workId: number | null;
  coverImage: string | null;
}

/**
 * Busca en el catálogo local (PublisherEdition) por título — incluso en español
 * y aunque no esté mapeado a AniList. Para encontrar ediciones argentinas por su
 * nombre real (lo que AniList no conoce). Una entrada por (serie/edición).
 */
export async function searchPublisherEditions(
  q: string,
  limit = 16,
): Promise<LocalCatalogHit[]> {
  const norm = normalizeTitle(q);
  if (norm.length < 2) return [];
  // Cada palabra (≥2) debe estar en el título normalizado → tolera orden/huecos
  // ("aroma cafe" matchea "historias con aroma a cafe").
  const tokens = norm.split(" ").filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const rows = await prisma.publisherEdition.findMany({
    where: { AND: tokens.map((t) => ({ normTitle: { contains: t } })) },
    select: {
      id: true,
      publisher: true,
      title: true,
      anilistId: true,
      workId: true,
      work: { select: { coverImage: true } },
    },
    orderBy: { volumes: "desc" },
    take: 60,
  });
  // Dedupe: una fila por obra (workId), o por serie mapeada / edición si falta.
  const seen = new Set<string>();
  const out: LocalCatalogHit[] = [];
  for (const r of rows) {
    const key = r.workId
      ? `w:${r.workId}`
      : r.anilistId
        ? `a:${r.anilistId}`
        : `e:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: r.id,
      publisher: r.publisher,
      title: r.title,
      anilistId: r.anilistId,
      workId: r.workId,
      coverImage: r.work?.coverImage ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
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
 * Portada del Work por anilistId. Cuando vino del import de Whakoom es la
 * portada de la EDICIÓN NACIONAL (más reconocible para coleccionistas locales);
 * si no, la de AniList que rellenamos. null si no hay Work/portada.
 */
export async function workCoverByAnilist(
  anilistId: number,
): Promise<string | null> {
  const w = await prisma.work.findUnique({
    where: { anilistId },
    select: { coverImage: true },
  });
  return w?.coverImage ?? null;
}

/** Set de anilistId marcados "próximo a salir" (flag manual del Work), vía edición. */
export async function upcomingByAnilist(ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (ids.length === 0) return out;
  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: { in: ids }, work: { upcoming: true } },
    select: { anilistId: true },
  });
  for (const r of rows) if (r.anilistId != null) out.add(r.anilistId);
  return out;
}

/**
 * Set de ids "próximo a salir", en el MISMO espacio de ids que la colección:
 * positivos = anilistId (vía edición), negativos = -editionId (obras nacionales).
 */
export async function upcomingForIds(ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const pos = ids.filter((i) => i > 0);
  const negEditionIds = ids.filter((i) => i < 0).map((i) => -i);
  if (pos.length) {
    const rows = await prisma.publisherEdition.findMany({
      where: { anilistId: { in: pos }, work: { upcoming: true } },
      select: { anilistId: true },
    });
    for (const r of rows) if (r.anilistId != null) out.add(r.anilistId);
  }
  if (negEditionIds.length) {
    const rows = await prisma.publisherEdition.findMany({
      where: { id: { in: negEditionIds }, work: { upcoming: true } },
      select: { id: true },
    });
    for (const r of rows) out.add(-r.id);
  }
  return out;
}

/**
 * Datos locales (del Work) por anilistId, vía edición→work: portada nacional,
 * flag "próximo a salir", y la info que copiamos de Whakoom (sinopsis/autor) para
 * preferirla a la de AniList en la ficha. AniList queda para los EXTRAS
 * (géneros, personajes, relaciones, score).
 */
export async function workMetaByAnilist(
  anilistId: number,
): Promise<{
  coverImage: string | null;
  upcoming: boolean;
  synopsis: string | null;
  author: string | null;
} | null> {
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId },
    select: {
      work: {
        select: { coverImage: true, upcoming: true, synopsis: true, author: true },
      },
    },
  });
  if (eds.length === 0) return null;
  return {
    coverImage: eds.map((e) => e.work?.coverImage).find(Boolean) ?? null,
    upcoming: eds.some((e) => e.work?.upcoming),
    synopsis: eds.map((e) => e.work?.synopsis).find(Boolean) ?? null,
    author: eds.map((e) => e.work?.author).find(Boolean) ?? null,
  };
}

/**
 * Portadas nacionales (del Work) para varios anilistId. Va por la EDICIÓN
 * (edición→work), no por work.anilistId, porque una edición puede estar mapeada
 * mientras su Work tiene anilistId null (se mapeó sin consolidar el Work).
 */
export async function nationalCoversByAnilist(
  ids: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: { in: ids }, work: { coverImage: { not: null } } },
    select: { anilistId: true, work: { select: { coverImage: true } } },
  });
  for (const r of rows)
    if (r.anilistId != null && r.work?.coverImage && !out.has(r.anilistId))
      out.set(r.anilistId, r.work.coverImage);
  return out;
}

/**
 * Encuentra (o crea) la obra del catálogo local para una edición. Agrupa por
 * `anilistId` cuando existe (referencia fuerte) y, si no, por título normalizado
 * (varias ediciones de la misma serie comparten título). Devuelve el workId.
 */
export async function findOrCreateWork(opts: {
  title: string;
  anilistId?: number | null;
  coverImage?: string | null;
  author?: string | null;
  synopsis?: string | null;
}): Promise<number> {
  const normTitle = normalizeTitle(opts.title);

  // Buscamos la obra existente: por anilistId (fuerte) o por título. Para el
  // matcheo por título usamos la llave ESTRICTA (distingue Citrus de Citrus+):
  // traemos los candidatos por normTitle (indexado) y filtramos por tightTitleKey.
  // Si le falta portada/autor/sinopsis y ahora lo tenemos, lo completamos (sin pisar).
  let existing:
    | { id: number; coverImage: string | null; author: string | null; synopsis: string | null }
    | null;
  if (opts.anilistId) {
    existing = await prisma.work.findUnique({
      where: { anilistId: opts.anilistId },
      select: { id: true, coverImage: true, author: true, synopsis: true },
    });
  } else {
    const tight = tightTitleKey(opts.title);
    const cands = await prisma.work.findMany({
      where: { normTitle },
      select: { id: true, coverImage: true, author: true, synopsis: true, title: true },
    });
    existing = cands.find((w) => tightTitleKey(w.title) === tight) ?? null;
  }

  if (existing) {
    const patch: { coverImage?: string; author?: string; synopsis?: string } = {};
    if (!existing.coverImage && opts.coverImage) patch.coverImage = opts.coverImage;
    if (!existing.author && opts.author) patch.author = opts.author;
    if (!existing.synopsis && opts.synopsis) patch.synopsis = opts.synopsis;
    if (Object.keys(patch).length)
      await prisma.work.update({ where: { id: existing.id }, data: patch }).catch(() => {});
    return existing.id;
  }

  const created = await prisma.work.create({
    data: {
      title: opts.title,
      normTitle,
      anilistId: opts.anilistId ?? null,
      coverImage: opts.coverImage ?? null,
      author: opts.author ?? null,
      synopsis: opts.synopsis ?? null,
    },
  });
  return created.id;
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
  coverImage: string | null;
  upcoming: boolean;
}

const editorialSelect = {
  id: true,
  title: true,
  anilistId: true,
  volumes: true,
  url: true,
  work: { select: { coverImage: true, upcoming: true } },
} as const;

type EditorialRow = {
  id: number;
  title: string;
  anilistId: number | null;
  volumes: number;
  url: string;
  work: { coverImage: string | null; upcoming: boolean } | null;
};

const toEditorialWork = (r: EditorialRow): EditorialWork => ({
  id: r.id,
  title: r.title,
  anilistId: r.anilistId,
  volumes: r.volumes,
  url: r.url,
  coverImage: r.work?.coverImage ?? null,
  upcoming: r.work?.upcoming ?? false,
});

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
      select: editorialSelect,
    }),
  ]);
  return {
    works: rows.map(toEditorialWork),
    lastPage: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Todo el catálogo de una editorial (para filtrar/paginar client-side). */
export async function getEditorialAll(
  publisher: string,
): Promise<EditorialWork[]> {
  const rows = await prisma.publisherEdition.findMany({
    where: { publisher },
    orderBy: { normTitle: "asc" },
    select: editorialSelect,
  });
  return rows.map(toEditorialWork);
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
  nationalOnly: boolean;
}

export async function getEditionMappings(opts: {
  publisher?: string;
  state?: "mapped" | "unmapped" | "national" | "comic" | "nocover";
  q?: string;
  page?: number;
  perPage?: number;
}): Promise<{ rows: EditionMapping[]; total: number; lastPage: number }> {
  const perPage = opts.perPage ?? 40;
  const page = Math.max(1, opts.page ?? 1);

  const where: {
    publisher?: string;
    anilistId?: { not: null } | null;
    nationalOnly?: boolean;
    normTitle?: { contains: string };
    volumesList?: { none: { coverImage: { not: null } } };
    OR?: ({ workId: null } | { work: { coverImage: null } })[];
  } = {};
  if (opts.publisher) where.publisher = opts.publisher;
  if (opts.state === "mapped") where.anilistId = { not: null };
  // "Sin mapear" = sin AniList y que NO sea una obra solo-nacional a propósito.
  if (opts.state === "unmapped") {
    where.anilistId = null;
    where.nationalOnly = false;
  }
  if (opts.state === "national") where.nationalOnly = true;
  // "Sin portada" = nacional (sin fallback de AniList) y sin imagen en su Work
  // ni en sus tomos → la card sale sin imagen. Acá es donde hay que actuar.
  if (opts.state === "nocover") {
    where.anilistId = null;
    where.volumesList = { none: { coverImage: { not: null } } };
    where.OR = [{ workId: null }, { work: { coverImage: null } }];
  }
  if (opts.q) where.normTitle = { contains: normalizeTitle(opts.q) };

  const select = {
    id: true,
    publisher: true,
    title: true,
    slug: true,
    url: true,
    volumes: true,
    anilistId: true,
    nationalOnly: true,
  } as const;

  // "Sospecha cómic" no es queryable (lista de términos en JS): traemos las
  // entradas sin mapear y filtramos/paginamos en memoria.
  if (opts.state === "comic") {
    where.anilistId = null;
    const all = await prisma.publisherEdition.findMany({
      where,
      orderBy: { normTitle: "asc" },
      select,
    });
    const hits = all.filter((r) => looksLikeComic(r.title));
    const total = hits.length;
    const rows = hits.slice((page - 1) * perPage, page * perPage);
    return { rows, total, lastPage: Math.max(1, Math.ceil(total / perPage)) };
  }

  const [total, rows] = await Promise.all([
    prisma.publisherEdition.count({ where }),
    prisma.publisherEdition.findMany({
      where,
      orderBy: { normTitle: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select,
    }),
  ]);
  return { rows, total, lastPage: Math.max(1, Math.ceil(total / perPage)) };
}

/** Conteos para el panel: posibles cómics y ediciones nacionales sin portada. */
export async function getCatalogFlags(): Promise<{ comics: number; noCover: number }> {
  const [unmapped, noCover] = await Promise.all([
    prisma.publisherEdition.findMany({
      where: { anilistId: null },
      select: { title: true },
    }),
    prisma.publisherEdition.count({
      where: {
        anilistId: null,
        volumesList: { none: { coverImage: { not: null } } },
        OR: [{ workId: null }, { work: { coverImage: null } }],
      },
    }),
  ]);
  return { comics: unmapped.filter((r) => looksLikeComic(r.title)).length, noCover };
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
    notifiedVolumes?: number;
    anilistId?: number | null;
  } = {};
  if (data.title !== undefined) {
    patch.title = data.title.trim();
    patch.normTitle = normalizeTitle(data.title);
  }
  if (data.url !== undefined) patch.url = data.url.trim();
  if (data.volumes !== undefined && Number.isFinite(data.volumes)) {
    patch.volumes = data.volumes;
    // Re-baselineamos el conteo notificado al valor que setea el admin: una
    // corrección manual no debe spamear "tomo nuevo", y deja el 0→1 de una
    // preventa listo para que el crawl lo detecte como lanzamiento real.
    patch.notifiedVolumes = data.volumes;
  }
  if (data.anilistId !== undefined) patch.anilistId = data.anilistId;
  await prisma.publisherEdition.update({ where: { id }, data: patch });
}

export async function deletePublisherEdition(id: number) {
  await prisma.publisherEdition.deleteMany({ where: { id } });
}

/** Marca/desmarca una edición como solo-nacional (sin equivalente en AniList). */
export async function setEditionNationalOnly(id: number, value: boolean) {
  await prisma.publisherEdition.update({
    where: { id },
    data: { nationalOnly: value },
  });
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
