import {
  searchMangaList,
  getTrendingManga,
  getMangaPage,
  getMangaCovers,
} from "@/lib/anilist";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { displayTitle, isExactTitleMatch } from "@/lib/title";
import { getAllMangakas } from "@/lib/mangakas";
import {
  nationalEditionsByManga,
  getEditorialAll,
  editorialCounts,
  searchPublisherEditions,
  EDITORIALS,
  type EditorialWork,
  type LocalCatalogHit,
} from "@/lib/catalog";
import { seriesHref } from "@/lib/url";
import Pager from "@/components/Pager";
import FinishedFilterButton from "@/components/FinishedFilterButton";
import { MangakaList } from "@/components/MangakaBrowser";
import EditorialBrowser from "@/components/browse/EditorialBrowser";
import Dashboard from "@/components/Dashboard";
import Link from "next/link";

type Tab = "hot" | "az" | "mangaka" | "editoriales";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    tab?: string;
    page?: string;
    finished?: string;
    ed?: string;
  }>;
}) {
  const session = await auth();
  const loggedIn = !!session;
  const admin = isAdmin(session?.user?.email);

  const params = await searchParams;
  const query = params.search?.trim();

  // Home logueado sin búsqueda ni pestaña → dashboard personal.
  if (loggedIn && session?.user?.id && !query && !params.tab) {
    return <Dashboard userId={session.user.id} name={session.user.name} />;
  }
  const tab: Tab =
    params.tab === "az"
      ? "az"
      : params.tab === "mangaka"
        ? "mangaka"
        : params.tab === "editoriales"
          ? "editoriales"
          : "hot";
  const page = Math.max(1, Number(params.page) || 1);
  const onlyFinished = params.finished === "1";
  const editorial =
    EDITORIALS.find((e) => e.slug === params.ed) ?? EDITORIALS[0];

  let mangas: any[] = [];
  let localHits: LocalCatalogHit[] = [];
  let localCovers = new Map<number, string>();
  let allMangakas: { id: number; name: string }[] = [];
  let editorialWorks: EditorialWork[] = [];
  let edCounts: Record<string, number> = {};
  let pageInfo: { lastPage: number } | null = null;

  if (query) {
    const [raw, local] = await Promise.all([
      searchMangaList(query, loggedIn),
      searchPublisherEditions(query).catch(() => [] as LocalCatalogHit[]),
    ]);
    mangas = admin
      ? raw
      : raw.filter((m: any) => !m.isAdult || isExactTitleMatch(m.title, query));
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

  return (
    <main className="mx-auto max-w-6xl px-5 pb-12 pt-5">
      {query ? (
        <>
          <h2 className="mb-4 text-lg font-semibold">
            Resultados para &quot;{query}&quot;
          </h2>
          {mangas.length === 0 && localHits.length === 0 ? (
            <p className="text-sm text-muted">No encontramos resultados.</p>
          ) : (
            <MangaGrid mangas={mangas} nationalEditions={nationalEditions} />
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
                  const cover = h.anilistId ? localCovers.get(h.anilistId) : null;
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
        <MangaGrid mangas={mangas} nationalEditions={nationalEditions} />
      ) : tab === "az" ? (
        <>
          <FinishedFilterButton enabled active={onlyFinished} />
          <div className="mt-5">
            <MangaGrid
              mangas={mangas}
              nationalEditions={nationalEditions}
              byRomaji
            />
          </div>
          {pageInfo && (
            <Pager
              basePath={`/?tab=az` + (onlyFinished ? "&finished=1" : "")}
              page={page}
              lastPage={pageInfo.lastPage}
            />
          )}
        </>
      ) : tab === "mangaka" ? (
        <MangakaList all={allMangakas} />
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
  byRomaji = false,
}: {
  mangas: any[];
  nationalEditions: Map<number, string[]>;
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
        return (
          <Link
            key={manga.id}
            href={`/manga/${manga.id}`}
            className={`group overflow-hidden rounded-xl border bg-surface transition hover:border-accent ${
              national ? "border-accent/60" : "border-border"
            }`}
          >
            <div className="relative aspect-2/3 w-full overflow-hidden bg-surface-2">
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
                src={manga.coverImage.large}
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
