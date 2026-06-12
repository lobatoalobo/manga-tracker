import {
  searchMangaList,
  getTrendingManga,
  getMangaPage,
  getHiatusSet,
} from "@/lib/anilist";
import SearchBar from "@/components/SearchBar";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { displayTitle, isExactTitleMatch } from "@/lib/title";
import { getAllMangakas } from "@/lib/mangakas";
import {
  nationalEditionsByManga,
  getEditorialPage,
  editorialCounts,
  EDITORIALS,
  type EditorialWork,
} from "@/lib/catalog";
import Pager from "@/components/Pager";
import FinishedFilterButton from "@/components/FinishedFilterButton";
import {
  MangakaProvider,
  MangakaFilterInput,
  MangakaList,
} from "@/components/MangakaBrowser";
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
  let allMangakas: { id: number; name: string }[] = [];
  let editorialWorks: EditorialWork[] = [];
  let edCounts: Record<string, number> = {};
  let pageInfo: { lastPage: number } | null = null;

  if (query) {
    // +18 solo para logueados; y para no-admin, Hentai solo con nombre exacto.
    const raw = await searchMangaList(query, loggedIn);
    mangas = admin
      ? raw
      : raw.filter((m: any) => !m.isAdult || isExactTitleMatch(m.title, query));
  } else if (tab === "mangaka") {
    try {
      allMangakas = await getAllMangakas();
    } catch {
      allMangakas = [];
    }
  } else if (tab === "editoriales") {
    try {
      const [res, counts] = await Promise.all([
        getEditorialPage(editorial.publisher, page),
        editorialCounts(),
      ]);
      editorialWorks = res.works;
      pageInfo = { lastPage: res.lastPage };
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

  const [hiatusSet, nationalEditions] = await Promise.all([
    getHiatusSet(mangas.map((m: any) => m.id)),
    nationalEditionsByManga(mangas),
  ]);

  const azBase = `/?tab=az` + (onlyFinished ? "&finished=1" : "");
  const edBase = `/?tab=editoriales&ed=${editorial.slug}`;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">📚 Nakama</h1>
      <p className="mb-6 text-sm text-muted">
        Buscá un manga y agregalo a tu colección.
      </p>

      <SearchBar />

      {query ? (
        <>
          <h2 className="mt-8 mb-4 text-lg font-semibold">
            Resultados para &quot;{query}&quot;
          </h2>
          <MangaGrid
            mangas={mangas}
            hiatusSet={hiatusSet}
            nationalEditions={nationalEditions}
          />
        </>
      ) : (
        <div className="mt-8">
          <ModeSwitch tab={tab} />

          {tab === "hot" && (
            <div className="mt-5">
              <MangaGrid
                mangas={mangas}
                hiatusSet={hiatusSet}
                nationalEditions={nationalEditions}
              />
            </div>
          )}

          {tab === "az" && (
            <>
              <div className="mt-3">
                <FinishedFilterButton enabled active={onlyFinished} />
              </div>
              <div className="mt-5">
                <MangaGrid
                  mangas={mangas}
                  hiatusSet={hiatusSet}
                  nationalEditions={nationalEditions}
                />
              </div>
              {pageInfo && (
                <Pager basePath={azBase} page={page} lastPage={pageInfo.lastPage} />
              )}
            </>
          )}

          {tab === "mangaka" && (
            <MangakaProvider all={allMangakas}>
              <div className="mt-3">
                <MangakaFilterInput enabled />
              </div>
              <MangakaList />
            </MangakaProvider>
          )}

          {tab === "editoriales" && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
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
              <EditorialGrid works={editorialWorks} />
              {pageInfo && (
                <Pager basePath={edBase} page={page} lastPage={pageInfo.lastPage} />
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}

function MangaGrid({
  mangas,
  hiatusSet,
  nationalEditions,
}: {
  mangas: any[];
  hiatusSet: Set<number>;
  nationalEditions: Map<number, string[]>;
}) {
  if (mangas.length === 0) {
    return <p className="text-sm text-muted">No encontramos resultados.</p>;
  }
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
              {hiatusSet.has(manga.id) && (
                <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-black">
                  ⏸ En pausa
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
                src={manga.coverImage.large}
                alt={displayTitle(manga.title)}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            </div>
            <div className="p-3">
              <h3
                className="truncate text-sm font-semibold"
                title={displayTitle(manga.title)}
              >
                {displayTitle(manga.title)}
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

function EditorialGrid({ works }: { works: EditorialWork[] }) {
  if (works.length === 0) {
    return (
      <p className="mt-5 text-sm text-muted">
        No hay títulos indexados para esta editorial todavía.
      </p>
    );
  }
  return (
    <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {works.map((w) => (
        <Link
          key={w.id}
          href={w.anilistId ? `/manga/${w.anilistId}` : `/r/ed/${w.id}`}
          title={w.title}
          className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-accent"
        >
          <span className="truncate text-sm font-medium">{w.title}</span>
          <span className="shrink-0 text-xs text-muted">{w.volumes} tomos</span>
        </Link>
      ))}
    </div>
  );
}

function mangakaOf(manga: any): string {
  return manga?.staff?.nodes?.[0]?.name?.full ?? "";
}

/** Control segmentado de modos de descubrimiento. */
function ModeSwitch({ tab }: { tab: Tab }) {
  const modes: { key: Tab; href: string; label: string }[] = [
    { key: "hot", href: "/?tab=hot", label: "🔥 Hot" },
    { key: "az", href: "/?tab=az", label: "A-Z" },
    { key: "mangaka", href: "/?tab=mangaka", label: "Mangakas" },
    { key: "editoriales", href: "/?tab=editoriales", label: "Editoriales" },
  ];
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
      {modes.map((m) => (
        <Link
          key={m.key}
          href={m.href}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
            tab === m.key
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          {m.label}
        </Link>
      ))}
    </div>
  );
}
