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
import Pager from "@/components/Pager";
import Link from "next/link";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    tab?: string;
    page?: string;
    finished?: string;
  }>;
}) {
  const session = await auth();
  const loggedIn = !!session;
  const admin = isAdmin(session?.user?.email);

  const params = await searchParams;
  const query = params.search?.trim();
  const tab =
    params.tab === "az" ? "az" : params.tab === "mangaka" ? "mangaka" : "hot";
  const page = Math.max(1, Number(params.page) || 1);
  const onlyFinished = params.finished === "1";
  const isList = tab === "az" || tab === "mangaka";

  let mangas: any[];
  let pageInfo: { hasNextPage: boolean; lastPage: number } | null = null;

  if (query) {
    // Traemos +18 solo para logueados; y para no-admin, las series Hentai
    // solo se muestran si el nombre coincide exactamente con la búsqueda.
    const raw = await searchMangaList(query, loggedIn);
    mangas = admin
      ? raw
      : raw.filter(
          (m: any) => !m.isAdult || isExactTitleMatch(m.title, query),
        );
  } else if (isList) {
    const res = await getMangaPage(page, admin, onlyFinished);
    mangas = res.media;
    pageInfo = res.pageInfo;
    if (tab === "mangaka") {
      // AniList no permite ordenar por autor globalmente; ordenamos la página.
      mangas = [...mangas].sort((a, b) =>
        mangakaOf(a).localeCompare(mangakaOf(b)),
      );
    }
  } else {
    mangas = await getTrendingManga(admin);
  }

  const hiatusSet = await getHiatusSet(mangas.map((m: any) => m.id));

  const listBase =
    `/?tab=${tab}` + (onlyFinished ? "&finished=1" : "");

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">📚 Nakama</h1>
      <p className="mb-6 text-sm text-muted">
        Buscá un manga y agregalo a tu colección.
      </p>

      <SearchBar />

      {query ? (
        <h2 className="mt-8 mb-4 text-lg font-semibold">
          Resultados para &quot;{query}&quot;
        </h2>
      ) : (
        <div className="mt-8 mb-4 flex flex-wrap items-center gap-2">
          <Tab href="/?tab=hot" active={tab === "hot"}>
            🔥 Hot esta semana
          </Tab>
          <Tab href="/?tab=az" active={tab === "az"}>
            A-Z
          </Tab>
          <Tab href="/?tab=mangaka" active={tab === "mangaka"}>
            Mangaka
          </Tab>
          {isList && (
            <Link
              href={onlyFinished ? `/?tab=${tab}` : `/?tab=${tab}&finished=1`}
              className={`ml-1 rounded-lg px-3 py-2 text-sm transition ${
                onlyFinished
                  ? "bg-accent text-white"
                  : "border border-border text-muted hover:text-foreground"
              }`}
            >
              ✓ Solo terminadas
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {mangas.map((manga: any) => (
          <Link
            key={manga.id}
            href={`/manga/${manga.id}`}
            className="group overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent"
          >
            <div className="relative aspect-2/3 w-full overflow-hidden bg-surface-2">
              {hiatusSet.has(manga.id) && (
                <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-black">
                  ⏸ En pausa
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
        ))}
      </div>

      {!query && isList && pageInfo && (
        <Pager basePath={listBase} page={page} lastPage={pageInfo.lastPage} />
      )}
    </main>
  );
}

function mangakaOf(manga: any): string {
  return manga?.staff?.nodes?.[0]?.name?.full ?? "";
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-accent text-white"
          : "border border-border text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
