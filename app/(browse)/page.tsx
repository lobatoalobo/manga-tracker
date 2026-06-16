import {
  searchMangaPage,
  getTrendingManga,
  getMangaPage,
  getMangaCovers,
  type SearchPage,
} from "@/lib/anilist";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { displayTitle, isExactTitleMatch } from "@/lib/title";
import { getAllMangakas } from "@/lib/mangakas";
import {
  nationalEditionsByManga,
  nationalCoversByAnilist,
  upcomingByAnilist,
  getEditorialAll,
  getUpcomingWorks,
  getCatalogByLetter,
  getCatalogAll,
  editorialCounts,
  searchPublisherEditions,
  EDITORIALS,
  type EditorialWork,
  type LocalCatalogHit,
} from "@/lib/catalog";
import { seriesHref } from "@/lib/url";
import Pager from "@/components/Pager";
import PageJump from "@/components/browse/PageJump";
import LetterIndex from "@/components/browse/LetterIndex";
import FinishedFilterButton from "@/components/FinishedFilterButton";
import { MangakaList } from "@/components/MangakaBrowser";
import EditorialBrowser from "@/components/browse/EditorialBrowser";
import Dashboard from "@/components/Dashboard";
import CatalogRefreshBanner from "@/components/CatalogRefreshBanner";
import Link from "next/link";

type Tab = "hot" | "az" | "nacional" | "mangaka" | "editoriales" | "proximos";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    tab?: string;
    page?: string;
    finished?: string;
    ed?: string;
    letra?: string;
  }>;
}) {
  const session = await auth();
  const loggedIn = !!session;
  const admin = isAdmin(session?.user?.email);

  const params = await searchParams;
  const query = params.search?.trim();

  // Home logueado sin búsqueda ni pestaña → dashboard personal.
  if (loggedIn && session?.user?.id && !query && !params.tab) {
    return (
      <>
        {admin && (
          <div className="mx-auto max-w-6xl px-5 pt-5">
            <CatalogRefreshBanner />
          </div>
        )}
        <Dashboard userId={session.user.id} name={session.user.name} />
      </>
    );
  }
  const tab: Tab =
    params.tab === "az"
      ? "az"
      : params.tab === "nacional"
        ? "nacional"
        : params.tab === "mangaka"
          ? "mangaka"
          : params.tab === "editoriales"
            ? "editoriales"
            : params.tab === "proximos"
              ? "proximos"
              : "hot";
  // Modo Nacional A-Z: "all" (default, para buscar global) o una letra.
  const letra =
    params.letra && params.letra !== "all" ? params.letra.slice(0, 1) : "all";
  const page = Math.max(1, Number(params.page) || 1);
  const onlyFinished = params.finished === "1";
  const editorial =
    EDITORIALS.find((e) => e.slug === params.ed) ?? EDITORIALS[0];

  let mangas: any[] = [];
  let searchInfo: SearchPage["pageInfo"] | null = null;
  let localHits: LocalCatalogHit[] = [];
  let localCovers = new Map<number, string>();
  let allMangakas: { id: number; name: string }[] = [];
  let editorialWorks: EditorialWork[] = [];
  let edCounts: Record<string, number> = {};
  let pageInfo: { lastPage: number } | null = null;

  if (query) {
    const [res, local] = await Promise.all([
      searchMangaPage(query, loggedIn, page),
      searchPublisherEditions(query).catch(() => [] as LocalCatalogHit[]),
    ]);
    searchInfo = res.pageInfo;
    mangas = admin
      ? res.media
      : res.media.filter(
          (m: any) => !m.isAdult || isExactTitleMatch(m.title, query),
        );
    // Catálogo local: lo que AniList no encuentra por título en español. Saca
    // los que ya aparecen en los resultados de AniList.
    const anilistIds = new Set(mangas.map((m: any) => m.id));
    localHits = local.filter(
      (h) => !(h.anilistId && anilistIds.has(h.anilistId)),
    );
    // Portadas (de AniList) para los hits mapeados, en una sola query.
    localCovers = await getMangaCovers(
      localHits.flatMap((h) => (h.anilistId ? [h.anilistId] : [])),
    );
  } else if (tab === "mangaka") {
    try {
      allMangakas = await getAllMangakas();
    } catch {
      allMangakas = [];
    }
  } else if (tab === "editoriales") {
    try {
      const [works, counts] = await Promise.all([
        getEditorialAll(editorial.publisher),
        editorialCounts(),
      ]);
      editorialWorks = works;
      edCounts = counts;
    } catch {
      editorialWorks = [];
    }
  } else if (tab === "proximos") {
    editorialWorks = await getUpcomingWorks().catch(() => []);
  } else if (tab === "nacional") {
    editorialWorks = await (letra === "all"
      ? getCatalogAll()
      : getCatalogByLetter(letra)
    ).catch(() => []);
  } else if (tab === "az") {
    const res = await getMangaPage(page, admin, onlyFinished);
    mangas = res.media;
    pageInfo = res.pageInfo;
  } else {
    mangas = await getTrendingManga(admin);
  }

  const nationalEditions = await nationalEditionsByManga(mangas).catch(
    () => new Map<number, string[]>(),
  );
  // En búsqueda: primero las que tienen edición nacional (🇦🇷), después el resto
  // alfabético. (Ordena dentro de la página traída de AniList.)
  if (query) {
    mangas = [...mangas].sort((a: any, b: any) => {
      const na = nationalEditions.has(a.id) ? 0 : 1;
      const nb = nationalEditions.has(b.id) ? 0 : 1;
      if (na !== nb) return na - nb;
      return displayTitle(a.title).localeCompare(displayTitle(b.title), "es");
    });
  }
  // Portada nacional (cuando la tenemos) para identificar mejor en las listas.
  const nationalCovers = await nationalCoversByAnilist(
    mangas.map((m: any) => m.id),
  ).catch(() => new Map<number, string>());
  // Series marcadas "próximo a salir" (preventa AR) para el badge en las cards.
  const upcomingIds = await upcomingByAnilist(
    mangas.map((m: any) => m.id),
  ).catch(() => new Set<number>());

  return (
    <main className="mx-auto max-w-6xl px-5 pb-12 pt-5">
      {admin && <CatalogRefreshBanner />}
      {query ? (
        <>
          <h2 className="mb-1 text-lg font-semibold">
            Resultados para &quot;{query}&quot;
          </h2>
          {searchInfo && searchInfo.total > 0 && (
            <p className="mb-4 text-sm text-muted">
              {searchInfo.total} resultado{searchInfo.total === 1 ? "" : "s"}
              {searchInfo.lastPage > 1
                ? ` · página ${searchInfo.currentPage} de ${searchInfo.lastPage}`
                : ""}
            </p>
          )}
          {mangas.length === 0 && localHits.length === 0 ? (
            <p className="text-sm text-muted">No encontramos resultados.</p>
          ) : (
            <MangaGrid mangas={mangas} nationalEditions={nationalEditions} nationalCovers={nationalCovers} upcomingIds={upcomingIds} />
          )}

          {searchInfo && searchInfo.lastPage > 1 && (
            <Pager
              basePath={`/?search=${encodeURIComponent(query)}`}
              page={searchInfo.currentPage}
              lastPage={searchInfo.lastPage}
            />
          )}

          {localHits.length > 0 && (
            <section className="mt-8">
              <h3 className="mb-1 text-sm font-semibold">
                📚 En editoriales argentinas
              </h3>
              <p className="mb-3 text-xs text-muted">
                Ediciones del catálogo local que matchean tu búsqueda.
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {localHits.map((h) => {
                  const cover =
                    (h.anilistId ? localCovers.get(h.anilistId) : null) ??
                    h.coverImage ??
                    null;
                  return (
                    <li key={h.anilistId ? `a${h.anilistId}` : `e${h.id}`}>
                      <Link
                        href={h.anilistId ? seriesHref(h.anilistId) : `/nacional/${h.id}`}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-surface-2"
                      >
                        <span className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-2">
                          {cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={cover}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-base">📕</span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{h.title}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {h.publisher.replace(" Argentina", "")}
                          {!h.anilistId && " · 🇦🇷"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      ) : tab === "hot" ? (
        <MangaGrid mangas={mangas} nationalEditions={nationalEditions} nationalCovers={nationalCovers} upcomingIds={upcomingIds} />
      ) : tab === "az" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Todo AniList (A-Z) · descubrí series y sumalas a deseados.
            </p>
            <FinishedFilterButton enabled active={onlyFinished} />
          </div>
          <div className="mt-5">
            <MangaGrid
              mangas={mangas}
              nationalEditions={nationalEditions}
              nationalCovers={nationalCovers}
              upcomingIds={upcomingIds}
              byRomaji
            />
          </div>
          {pageInfo && pageInfo.lastPage > 1 && (
            <div className="mt-6 flex flex-col items-center gap-3">
              <PageJump
                page={page}
                lastPage={pageInfo.lastPage}
                basePath={`/?tab=az` + (onlyFinished ? "&finished=1" : "")}
              />
              <Pager
                basePath={`/?tab=az` + (onlyFinished ? "&finished=1" : "")}
                page={page}
                lastPage={pageInfo.lastPage}
              />
            </div>
          )}
        </>
      ) : tab === "nacional" ? (
        <>
          <p className="mb-3 text-sm text-muted">
            🇦🇷 Catálogo en Argentina · buscá arriba (All) o filtrá por letra.
          </p>
          <LetterIndex active={letra} />
          {editorialWorks.length === 0 ? (
            <p className="mt-5 text-sm text-muted">
              {letra === "all"
                ? "No hay obras en el catálogo todavía."
                : `No hay obras que empiecen con “${letra.toUpperCase()}”.`}
            </p>
          ) : (
            <EditorialBrowser works={editorialWorks} />
          )}
        </>
      ) : tab === "mangaka" ? (
        <MangakaList all={allMangakas} />
      ) : tab === "proximos" ? (
        editorialWorks.length === 0 ? (
          <p className="mt-5 text-sm text-muted">
            No hay series marcadas como próximas a salir por ahora.
          </p>
        ) : (
          <EditorialBrowser works={editorialWorks} />
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {EDITORIALS.map((e) => (
              <Link
                key={e.slug}
                href={`/?tab=editoriales&ed=${e.slug}`}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  e.slug === editorial.slug
                    ? "bg-accent text-white"
                    : "border border-border text-muted hover:text-foreground"
                }`}
              >
                {e.label}
                {edCounts[e.publisher] ? (
                  <span className="ml-1 opacity-70">
                    {edCounts[e.publisher]}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
          <EditorialBrowser works={editorialWorks} />
        </>
      )}
    </main>
  );
}

function MangaGrid({
  mangas,
  nationalEditions,
  nationalCovers,
  upcomingIds,
  byRomaji = false,
}: {
  mangas: any[];
  nationalEditions: Map<number, string[]>;
  nationalCovers?: Map<number, string>;
  upcomingIds?: Set<number>;
  byRomaji?: boolean;
}) {
  if (mangas.length === 0) {
    return <p className="text-sm text-muted">No encontramos resultados.</p>;
  }
  // En A-Z mostramos el romaji (es el campo por el que ordena AniList), así el
  // orden alfabético coincide con lo que se ve.
  const titleOf = (m: any) =>
    byRomaji ? m.title.romaji || displayTitle(m.title) : displayTitle(m.title);
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {mangas.map((manga: any) => {
        const national = nationalEditions.get(manga.id);
        const cover = nationalCovers?.get(manga.id) ?? manga.coverImage.large;
        const upcoming =
          upcomingIds?.has(manga.id) || manga.status === "NOT_YET_RELEASED";
        return (
          <Link
            key={manga.id}
            href={`/manga/${manga.id}`}
            className={`group overflow-hidden rounded-xl border bg-surface transition hover:border-accent ${
              national ? "border-accent/60" : "border-border"
            }`}
          >
            <div className="relative aspect-2/3 w-full overflow-hidden bg-surface-2">
              {upcoming && (
                <span
                  className="absolute left-2 top-2 z-10 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white"
                  title="Próximo a salir (preventa / anunciada en AR)"
                >
                  🔜 Pronto
                </span>
              )}
              {national && (
                <span
                  className="absolute right-2 top-2 z-10 rounded-full bg-sky-500/90 px-2 py-0.5 text-[10px] font-semibold text-white"
                  title={`Edición nacional: ${national.join(", ")}`}
                >
                  🇦🇷 Nacional
                </span>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={titleOf(manga)}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            </div>
            <div className="p-3">
              <h3
                className="truncate text-sm font-semibold"
                title={titleOf(manga)}
              >
                {titleOf(manga)}
              </h3>
              <p className="mt-1 truncate text-xs text-muted">
                {mangakaOf(manga) || manga.title.native}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function mangakaOf(manga: any): string {
  return manga?.staff?.nodes?.[0]?.name?.full ?? "";
}
