import { prisma } from "./prisma";

const ANILIST = "https://graphql.anilist.co";
const CURSOR_KEY = "mangakaCursor";

/** Roles de AniList que consideramos "mangaka" (autoría de la obra). */
const AUTHOR_ROLE = /story|art/i;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PageResult {
  authors: Map<number, string>;
  hasNextPage: boolean;
}

/** Una página de mangas (por popularidad) → sus autores únicos. */
async function fetchAuthorsPage(
  page: number,
  perPage: number,
): Promise<PageResult> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) {
          staff(perPage: 4, sort: RELEVANCE) {
            edges { role node { id name { full } } }
          }
        }
      }
    }
  `;
  const r = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { page, perPage } }),
  });
  const json = await r.json();
  const data = json?.data?.Page;

  const authors = new Map<number, string>();
  for (const m of data?.media ?? []) {
    for (const e of m.staff?.edges ?? []) {
      const id = e?.node?.id;
      const name = e?.node?.name?.full;
      if (id && name && AUTHOR_ROLE.test(e.role ?? "")) authors.set(id, name);
    }
  }
  return { authors, hasNextPage: !!data?.pageInfo?.hasNextPage };
}

async function getCursor(): Promise<number> {
  const row = await prisma.appState.findUnique({ where: { key: CURSOR_KEY } });
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function setCursor(page: number): Promise<void> {
  const value = String(page);
  await prisma.appState.upsert({
    where: { key: CURSOR_KEY },
    update: { value },
    create: { key: CURSOR_KEY, value },
  });
}

/**
 * Reconstruye/extiende el índice de mangakas escaneando mangas por popularidad.
 *
 * AniList no permite listar ni ordenar autores, así que los derivamos de los
 * mangas. Para no pegarle de más a su API ni pasar el timeout del cron, escanea
 * por tandas con cursor persistido: cada corrida sigue donde quedó la anterior
 * y, al llegar al final del catálogo, reinicia (refresca desde arriba).
 *
 * `resume: false` ignora el cursor y arranca de la página 1 (seed completo,
 * pensado para `npm run crawl`, sin timeout).
 */
export async function buildMangakaIndex({
  maxPages = 40,
  perPage = 50,
  timeBudgetMs = 45_000,
  throttleMs = 700,
  resume = true,
}: {
  maxPages?: number;
  perPage?: number;
  timeBudgetMs?: number;
  throttleMs?: number;
  resume?: boolean;
} = {}): Promise<{
  fromPage: number;
  scannedPages: number;
  collected: number;
  inserted: number;
  wrapped: boolean;
}> {
  const startedAt = Date.now();
  const fromPage = resume ? await getCursor() : 1;

  const collected = new Map<number, string>();
  let page = fromPage;
  let scanned = 0;
  let wrapped = false;

  for (; scanned < maxPages; scanned++) {
    if (Date.now() - startedAt > timeBudgetMs) break;

    let res: PageResult;
    try {
      res = await fetchAuthorsPage(page, perPage);
    } catch {
      // Error de red / rate-limit / tope de paginación de AniList: reiniciamos
      // el cursor para que la próxima corrida arranque desde arriba (refresca)
      // en vez de quedar trabada en una página que falla.
      wrapped = true;
      break;
    }

    for (const [id, name] of res.authors) collected.set(id, name);

    if (!res.hasNextPage) {
      wrapped = true;
      page = 1;
      break;
    }
    page++;
    if (scanned + 1 < maxPages) await sleep(throttleMs);
  }

  const inserted = await upsertMangakas(collected);
  await setCursor(wrapped ? 1 : page);

  return { fromPage, scannedPages: scanned, collected: collected.size, inserted, wrapped };
}

/** Seed completo (para scripts sin timeout): escanea hasta el final del catálogo. */
export async function seedMangakaIndex(): Promise<number> {
  let total = 0;
  let wrapped = false;
  // Arranca de cero y va de a tandas grandes hasta dar la vuelta al catálogo.
  let first = true;
  while (!wrapped) {
    const r = await buildMangakaIndex({
      maxPages: 25,
      timeBudgetMs: 10 * 60_000,
      resume: !first,
    });
    first = false;
    total += r.inserted;
    wrapped = r.wrapped;
    if (r.scannedPages === 0) break;
  }
  return total;
}

async function upsertMangakas(map: Map<number, string>): Promise<number> {
  if (map.size === 0) return 0;
  const rows = [...map].map(([id, name]) => ({
    id,
    name,
    normName: norm(name),
    updatedAt: new Date(),
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await prisma.mangaka.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  return inserted;
}

/**
 * Todos los mangakas ordenados alfabéticamente. La lista (solo id + nombre) se
 * manda al cliente para filtrar/paginar al instante mientras se tipea.
 */
export async function getAllMangakas(): Promise<{ id: number; name: string }[]> {
  return prisma.mangaka.findMany({
    orderBy: { normName: "asc" },
    select: { id: true, name: true },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
