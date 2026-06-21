import { prisma } from "@/lib/prisma";
import { looksLikeComic } from "@/lib/comicTerms";
import { rejectEditions } from "@/lib/rejectedSources";
/**
 * ¿El nombre de autor `target` está en el string de autores `field` por NOMBRE
 * (todos sus tokens presentes), no por substring? Evita que "ONE" matchee
 * "BONES"/"Kurone". Maneja el orden y el formato "Apellido, Nombre".
 */
export function authorNameMatches(
  target: string,
  field: string | null | undefined,
): boolean {
  if (!field) return false;
  const tok = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  const t = tok(target);
  if (t.length === 0) return false;
  const all = new Set(tok(field));
  return t.every((x) => all.has(x));
}

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

/**
 * Editoriales que el catálogo MUESTRA hoy (MVP = solo Ivrea, la fuente más
 * validada y con fechas/próximos). Las demás (Panini/Ovni argentinas y las
 * españolas Distrito/Kemuri/Utopía/Larp/Planeta) están en la base pero NO se
 * listan en el browse/búsqueda hasta sumarlas bien. Ampliar acá cuando toque.
 */
export const CATALOG_PUBLISHERS = ["Ivrea Argentina"] as const;

/**
 * Editoriales EXTRANJERAS que el catálogo muestra en la sección Internacional
 * (separada del catálogo nacional). MVP: VIZ Media (inglés). Ver docs/plan-viz-en.md.
 */
export const INTL_PUBLISHERS = ["VIZ Media"] as const;

/** Filtro Prisma: obras con alguna edición internacional (VIZ). */
export function intlCatalogWhere(): import("@prisma/client").Prisma.WorkWhereInput {
  return { editions: { some: { publisher: { in: [...INTL_PUBLISHERS] } } } };
}

/**
 * Editoriales que el catálogo VISIBLE muestra: nacionales activas (Ivrea) +
 * internacionales (VIZ). El catálogo es uno solo; las banderas distinguen el
 * origen de cada obra dentro de la lista combinada (A-Z).
 */
export const VISIBLE_PUBLISHERS = [
  ...CATALOG_PUBLISHERS,
  ...INTL_PUBLISHERS,
] as const;

/**
 * Filtro Prisma: una obra entra al catálogo visible si tiene una edición de una
 * editorial activa (CATALOG_PUBLISHERS) o es un debut próximo (upcoming, sin
 * edición aún). Fuente única para browse/búsqueda/autores/sitemap.
 */
export function inCatalogWhere(): import("@prisma/client").Prisma.WorkWhereInput {
  return {
    OR: [
      // Tiene una edición visible (Ivrea/VIZ). NO exigimos volumes>0: una serie
      // real puede tener 0 tomos por un gap de conteo (Whakoom) o por ser
      // reciente — mejor mostrarla que hacerla desaparecer. (El conteo lo arregla
      // el crawl; el caso novela/artbook se resuelve con Work.type, no ocultando.)
      { editions: { some: { publisher: { in: [...VISIBLE_PUBLISHERS] } } } },
      // O es un debut GENUINO: próximo a salir y sin NINGUNA edición todavía.
      { upcoming: true, editions: { none: {} } },
    ],
  };
}

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

export async function upsertPublisherEdition(e: {
  publisher: string;
  slug: string;
  title: string;
  volumes: number;
  status?: string | null;
  url: string;
  language?: string; // "es" (default) | "en" | "ja"
  country?: string | null; // "AR" | "US" | …
}): Promise<void> {
  const intl =
    e.language || e.country !== undefined
      ? { language: e.language ?? "es", country: e.country ?? null }
      : {};
  await prisma.publisherEdition.upsert({
    where: { publisher_slug: { publisher: e.publisher, slug: e.slug } },
    update: {
      title: e.title,
      normTitle: normalizeTitle(e.title),
      volumes: e.volumes,
      status: e.status ?? null,
      url: e.url,
      ...intl,
    },
    create: {
      publisher: e.publisher,
      slug: e.slug,
      title: e.title,
      normTitle: normalizeTitle(e.title),
      volumes: e.volumes,
      status: e.status ?? null,
      url: e.url,
      ...intl,
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

/**
 * Set de ids "próximo a salir", en el MISMO espacio de ids que la colección:
 * positivos = anilistId (vía edición), negativos = -workId (catálogo local).
 */
export async function upcomingForIds(ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const pos = ids.filter((i) => i > 0);
  const negWorkIds = ids.filter((i) => i < 0).map((i) => -i);
  if (pos.length) {
    const rows = await prisma.publisherEdition.findMany({
      where: { anilistId: { in: pos }, work: { upcoming: true } },
      select: { anilistId: true },
    });
    for (const r of rows) if (r.anilistId != null) out.add(r.anilistId);
  }
  if (negWorkIds.length) {
    // Negativos = -workId: el flag upcoming vive en el Work, no en la edición.
    // Guard: excluir las que ya tienen edición publicada (flag viejo).
    const rows = await prisma.work.findMany({
      where: {
        id: { in: negWorkIds },
        upcoming: true,
        editions: { none: { volumes: { gt: 0 } } },
      },
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
  releaseLabel: string | null;
} | null> {
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId },
    select: {
      work: {
        select: {
          coverImage: true, upcoming: true, synopsis: true, author: true,
          releaseLabel: true,
        },
      },
    },
  });
  if (eds.length === 0) return null;
  return {
    coverImage: eds.map((e) => e.work?.coverImage).find(Boolean) ?? null,
    upcoming: eds.some((e) => e.work?.upcoming),
    synopsis: eds.map((e) => e.work?.synopsis).find(Boolean) ?? null,
    author: eds.map((e) => e.work?.author).find(Boolean) ?? null,
    releaseLabel: eds.map((e) => e.work?.releaseLabel).find(Boolean) ?? null,
  };
}

/** Índice de autores derivado de `Work.author` (sin tabla aparte). */
export async function getLocalAuthors(): Promise<{ name: string; count: number }[]> {
  const works = await prisma.work.findMany({
    where: { author: { not: null }, ...inCatalogWhere() },
    select: { author: true },
  });
  const byKey = new Map<string, { name: string; count: number }>();
  for (const w of works) {
    for (const raw of (w.author ?? "").split(/,|&| y /i)) {
      const name = raw.trim();
      if (name.length < 2) continue;
      const key = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const ex = byKey.get(key);
      if (ex) ex.count++;
      else byKey.set(key, { name, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Búsqueda liviana de obras locales (para pickers/autocomplete). Devuelve el id
 * como NEGATIVO (-workId) para que el resto del sistema lo trate como obra local
 * (links a /serie, colección por workId).
 */
export async function searchWorksLite(
  q: string,
  limit = 8,
): Promise<{ id: number; title: string; coverImage: string | null }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const works = await prisma.work.findMany({
    where: {
      AND: [
        {
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { normTitle: { contains: normalizeTitle(term) } },
            { originalTitle: { contains: term, mode: "insensitive" } },
          ],
        },
        inCatalogWhere(),
      ],
    },
    orderBy: { normTitle: "asc" },
    take: limit,
    select: { id: true, title: true, coverImage: true },
  });
  return works.map((w) => ({ id: -w.id, title: w.title, coverImage: w.coverImage }));
}

/** Etiqueta corta de editorial para el picker ("Ivrea Argentina" → "Ivrea"). */
export const PUBLISHER_SHORT: Record<string, string> = {
  "Ivrea Argentina": "Ivrea",
  "VIZ Media": "VIZ",
};
export function publisherShort(p: string): string {
  return PUBLISHER_SHORT[p] ?? p;
}

/** Key estable de edición por editorial (coherente con colección/compras/ficha). */
export const PUBLISHER_KEY: Record<string, string> = {
  "Ivrea Argentina": "ivrea",
  "Panini Argentina": "panini",
  "Ovni Press": "ovni",
  "Kemuri Ediciones": "kemuri",
  "Utopía Editorial": "utopia",
  "Larp Editores": "larp",
  "Distrito Manga": "distrito",
  "Planeta Cómic": "planeta",
  "VIZ Media": "viz",
};
export function publisherKey(p: string): string {
  return PUBLISHER_KEY[p] ?? "ar";
}
/** Región de la edición por editorial (VIZ = internacional). */
export function publisherRegionOf(p: string): string {
  return /viz/i.test(p) ? "INT" : "AR";
}

export interface PurchaseEditionResult {
  id: number; // -workId
  title: string;
  coverImage: string | null;
  publisher: string | null; // editorial de ESTA entrada (null = obra sin edición)
  label: string; // "Título — Editorial"
  intl: boolean; // edición internacional (VIZ)
  volumes: number; // tomos conocidos de la edición (para validar el # de tomo)
}

/**
 * Búsqueda para el form de compras: devuelve una entrada POR EDICIÓN visible
 * (Ivrea, VIZ), de modo que al elegir "Chainsaw Man — VIZ" ya sabemos serie +
 * editorial + a qué colección sumarlo (sin dropdown de editorial aparte).
 */
export async function searchPurchaseEditions(
  q: string,
  limit = 8,
): Promise<PurchaseEditionResult[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const works = await prisma.work.findMany({
    where: {
      AND: [
        {
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { normTitle: { contains: normalizeTitle(term) } },
            { originalTitle: { contains: term, mode: "insensitive" } },
          ],
        },
        inCatalogWhere(),
      ],
    },
    orderBy: { normTitle: "asc" },
    take: limit,
    select: {
      id: true,
      title: true,
      coverImage: true,
      editions: { select: { publisher: true, volumes: true } },
    },
  });

  const out: PurchaseEditionResult[] = [];
  for (const w of works) {
    // Tomos por editorial (la de más tomos si hubiera varias del mismo publisher).
    const volsByPub = new Map<string, number>();
    for (const e of w.editions) {
      if (!(VISIBLE_PUBLISHERS as readonly string[]).includes(e.publisher)) continue;
      volsByPub.set(e.publisher, Math.max(volsByPub.get(e.publisher) ?? 0, e.volumes));
    }
    const pubs = [...volsByPub.keys()];
    if (pubs.length === 0) {
      // Debut sin edición cargada: una sola entrada sin editorial.
      out.push({
        id: -w.id,
        title: w.title,
        coverImage: w.coverImage,
        publisher: null,
        label: w.title,
        intl: false,
        volumes: 0,
      });
      continue;
    }
    for (const p of pubs) {
      out.push({
        id: -w.id,
        title: w.title,
        coverImage: w.coverImage,
        publisher: p,
        label: `${w.title} — ${publisherShort(p)}`,
        intl: INTL_SET.has(p),
        volumes: volsByPub.get(p) ?? 0,
      });
    }
  }
  return out.slice(0, limit + 4);
}

export interface WorkCard {
  id: number;
  title: string;
  coverImage: string | null;
  publishers: string[];
  national: boolean; // tiene alguna edición de editorial argentina
  intl: boolean; // sección Internacional (edición VIZ/extranjera)
  upcoming: boolean;
  releaseLabel: string | null;
  genres: string[];
  demographic: string | null;
  maxVolumes: number; // tomos de la edición más larga (para ordenar "más tomos")
  next: { volume: number | null; date: Date } | null; // próximo tomo NUEVO
  reissue: { volume: number | null; date: Date } | null; // próxima reedición
}

const AR_PUBLISHERS = new Set<string>(PUBLISHERS);
const INTL_SET = new Set<string>(INTL_PUBLISHERS);

export interface WishEditionLite {
  key: string;
  publisher: string | null;
  region: string | null;
  label: string;
}

/** Ediciones deseables de una obra a partir de sus editoriales visibles. */
export function wishEditionsFor(
  publishers: string[],
  national: boolean,
): WishEditionLite[] {
  const seen = new Set<string>();
  const eds: WishEditionLite[] = [];
  for (const p of publishers) {
    const key = publisherKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    eds.push({ key, publisher: p, region: publisherRegionOf(p), label: publisherShort(p) });
  }
  if (eds.length === 0 && national)
    eds.push({ key: "ivrea", publisher: "Ivrea Argentina", region: "AR", label: "Ivrea" });
  return eds;
}

/**
 * Banderas y editoriales visibles de una obra. ÚNICA fuente de verdad para las
 * cards (catálogo, autor, etc.) → no se desincronizan.
 * - `national` = tiene edición Ivrea (la AR visible) o es un debut GENUINO
 *   (anunciado y SIN ninguna edición). NO se marca nacional por el flag
 *   `upcoming` si ya tiene otra edición (ej. una obra solo-VIZ no es AR).
 * - `intl` = tiene edición VIZ.
 * - `isUpcoming` = badge "próximo a salir" (anunciado y sin tomos publicados).
 */
export function workCardFlags(
  editions: { publisher: string; volumes: number }[],
  upcoming: boolean,
): { national: boolean; intl: boolean; isUpcoming: boolean; publishers: string[] } {
  const genuineDebut = upcoming && editions.length === 0;
  const isUpcoming = upcoming && !editions.some((e) => e.volumes > 0);
  const national =
    genuineDebut ||
    editions.some((e) => (CATALOG_PUBLISHERS as readonly string[]).includes(e.publisher));
  const intl = editions.some((e) => INTL_SET.has(e.publisher));
  const publishers = [
    ...new Set(
      editions
        .filter((e) => (VISIBLE_PUBLISHERS as readonly string[]).includes(e.publisher))
        .map((e) => e.publisher),
    ),
  ];
  return { national, intl, isUpcoming, publishers };
}

/**
 * Browse/búsqueda del catálogo LOCAL (`Work`), sin AniList. `tab`:
 *  - "az" (default): alfabético.
 *  - "series": próximas SERIES (debuts marcados `upcoming`, desde /news/).
 *  - "tomos": obras con un próximo TOMO (fecha futura en IvreaRelease).
 * `q` filtra por título (título visible o normalizado).
 */
export async function browseWorks(opts: {
  q?: string;
  tab?: "az" | "series" | "tomos";
  take?: number;
  page?: number;
  /** Filtra por autor (nombre exacto por tokens, no substring). Para /autores. */
  author?: string;
}): Promise<{ items: WorkCard[]; total: number }> {
  const take = opts.take ?? 60;
  const page = Math.max(1, opts.page ?? 1);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const q = opts.q?.trim();

  type WorkWhere = import("@prisma/client").Prisma.WorkWhereInput;
  const qFilter: WorkWhere | null = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { normTitle: { contains: normalizeTitle(q) } },
        ],
      }
    : null;

  // MVP: el catálogo muestra SOLO obras de las editoriales activas (Ivrea) o
  // debuts próximos de Ivrea (que aún no tienen edición). Excluye obras que solo
  // existen en otras editoriales (Panini/Ovni/españolas) hasta sumarlas bien.
  const conds: WorkWhere[] = [inCatalogWhere()];
  if (qFilter) conds.push(qFilter);
  // Prefiltro por substring en DB; el match exacto por nombre se hace abajo.
  if (opts.author)
    conds.push({ author: { contains: opts.author, mode: "insensitive" } });

  // A-Z combina nacional + internacional. Las pestañas series/tomos son del
  // catálogo nacional (debuts y releases de Ivrea): naturalmente solo traen
  // obras nacionales (las VIZ no tienen debut/release de Ivrea).
  if (opts.tab === "series") {
    // Próximas SERIES: debuts GENUINOS (upcoming + sin ninguna edición). Si ya
    // tiene una edición (de Ivrea o de otra editorial), no es un debut próximo.
    conds.push({ upcoming: true, editions: { none: {} } });
  } else if (opts.tab === "tomos") {
    // Próximos TOMOS: obras con un tomo nuevo o reedición futura (vía edición→
    // work). NO incluye debuts/oneshots (esos son "series nuevas", otro tab/chip).
    const rel = await prisma.ivreaRelease.findMany({
      where: {
        editionId: { not: null },
        kind: { in: ["volume", "reissue"] },
        releaseDate: { gte: today },
      },
      select: { editionId: true },
    });
    const edIds = [...new Set(rel.map((r) => r.editionId as number))];
    const eds = edIds.length
      ? await prisma.publisherEdition.findMany({
          where: { id: { in: edIds }, workId: { not: null } },
          select: { workId: true },
        })
      : [];
    const wIds = [...new Set(eds.map((e) => e.workId as number))];
    conds.push({ id: { in: wIds } });
  }

  const where: WorkWhere = conds.length === 1 ? conds[0] : { AND: conds };

  const [worksRaw, totalRaw] = await Promise.all([
    prisma.work.findMany({
      where,
      orderBy: { normTitle: "asc" },
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        title: true,
        coverImage: true,
        upcoming: true,
        releaseLabel: true,
        genres: true,
        demographic: true,
        author: true,
        editions: { select: { id: true, publisher: true, volumes: true } },
      },
    }),
    prisma.work.count({ where }),
  ]);
  // Match exacto por nombre de autor (el `contains` de DB es laxo: "ONE"⊂"BONES").
  const works = opts.author
    ? worksRaw.filter((w) => authorNameMatches(opts.author!, w.author))
    : worksRaw;
  const total = opts.author ? works.length : totalRaw;

  // Próxima salida por work (badge de la card). Incluye reediciones, con su
  // `kind`. Si una serie tiene tomo NUEVO y reedición en camino, prioriza el
  // tomo nuevo (más relevante); si solo hay reediciones, muestra la más cercana.
  const allEdIds = works.flatMap((w) => w.editions.map((e) => e.id));
  const rel = allEdIds.length
    ? await prisma.ivreaRelease.findMany({
        where: {
          editionId: { in: allEdIds },
          kind: { in: ["volume", "reissue"] }, // NO debut/oneshot (son "nueva serie")
          releaseDate: { gte: today },
        },
        orderBy: { releaseDate: "asc" },
        select: { editionId: true, volume: true, releaseDate: true, kind: true },
      })
    : [];
  type Rel = { volume: number | null; date: Date; kind: "new" | "reissue" };
  const relByEd = new Map<number, Rel[]>();
  for (const r of rel)
    if (r.editionId != null && r.releaseDate) {
      const arr = relByEd.get(r.editionId) ?? [];
      arr.push({
        volume: r.volume,
        date: r.releaseDate,
        kind: r.kind === "reissue" ? "reissue" : "new",
      });
      relByEd.set(r.editionId, arr);
    }

  const items = works.map((w) => {
    const all: Rel[] = [];
    for (const e of w.editions) {
      const a = relByEd.get(e.id);
      if (a) all.push(...a);
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime());
    // Separados: tomo nuevo y reedición (la card muestra AMBOS chips si los hay).
    const newRel = all.find((x) => x.kind === "new") ?? null;
    const reissueRel = all.find((x) => x.kind === "reissue") ?? null;
    const next: { volume: number | null; date: Date } | null = newRel
      ? { volume: newRel.volume, date: newRel.date }
      : null;
    const reissue: { volume: number | null; date: Date } | null = reissueRel
      ? { volume: reissueRel.volume, date: reissueRel.date }
      : null;
    const flags = workCardFlags(w.editions, w.upcoming);
    return {
      id: w.id,
      title: w.title,
      coverImage: w.coverImage,
      publishers: flags.publishers,
      national: flags.national,
      intl: flags.intl,
      upcoming: flags.isUpcoming,
      releaseLabel: w.releaseLabel,
      genres: w.genres,
      demographic: w.demographic,
      maxVolumes: w.editions.reduce((m, e) => Math.max(m, e.volumes), 0),
      next,
      reissue,
    };
  });
  return { items, total };
}

/**
 * Próxima salida de Ivrea para una serie (el tomo futuro más cercano, según el
 * snapshot de /proximas/). Excluye reediciones (esas van por su propio aviso).
 */
export async function nextIvreaRelease(
  anilistId: number,
): Promise<{ volume: number | null; date: Date } | null> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const r = await prisma.ivreaRelease.findFirst({
    where: { anilistId, kind: "volume", releaseDate: { gte: today } },
    orderBy: { releaseDate: "asc" },
    select: { volume: true, releaseDate: true },
  });
  return r?.releaseDate ? { volume: r.volume, date: r.releaseDate } : null;
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
  originalTitle?: string | null;
}): Promise<number> {
  const normTitle = normalizeTitle(opts.title);

  // Buscamos la obra existente: por anilistId (fuerte) o por título. Para el
  // matcheo por título usamos la llave ESTRICTA (distingue Citrus de Citrus+):
  // traemos los candidatos por normTitle (indexado) y filtramos por tightTitleKey.
  // Si le falta portada/autor/sinopsis y ahora lo tenemos, lo completamos (sin pisar).
  let existing:
    | { id: number; coverImage: string | null; author: string | null; synopsis: string | null; originalTitle: string | null }
    | null;
  if (opts.anilistId) {
    existing = await prisma.work.findUnique({
      where: { anilistId: opts.anilistId },
      select: { id: true, coverImage: true, author: true, synopsis: true, originalTitle: true },
    });
  } else {
    const tight = tightTitleKey(opts.title);
    const cands = await prisma.work.findMany({
      where: { normTitle },
      select: { id: true, coverImage: true, author: true, synopsis: true, originalTitle: true, title: true },
    });
    existing = cands.find((w) => tightTitleKey(w.title) === tight) ?? null;
  }

  if (existing) {
    const patch: { coverImage?: string; author?: string; synopsis?: string; originalTitle?: string } = {};
    if (!existing.coverImage && opts.coverImage) patch.coverImage = opts.coverImage;
    if (!existing.author && opts.author) patch.author = opts.author;
    if (!existing.synopsis && opts.synopsis) patch.synopsis = opts.synopsis;
    if (!existing.originalTitle && opts.originalTitle) patch.originalTitle = opts.originalTitle;
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
      originalTitle: opts.originalTitle ?? null,
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
  // Registra la fuente como descartada para que el crawl no la re-importe.
  await rejectEditions([id]).catch(() => {});
  await prisma.publisherEdition.deleteMany({ where: { id } });
}

/** Marca/desmarca una edición como solo-nacional (sin equivalente en AniList). */
export async function setEditionNationalOnly(id: number, value: boolean) {
  await prisma.publisherEdition.update({
    where: { id },
    data: { nationalOnly: value },
  });
}
