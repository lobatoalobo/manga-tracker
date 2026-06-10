import {
  searchMangaList,
  getTrendingManga,
  getMangaPage,
} from "@/lib/anilist";
import SearchBar from "@/components/SearchBar";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import Link from "next/link";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tab?: string; page?: string }>;
}) {
  const session = await auth();
  // +18 en búsqueda: cualquier logueado. En listados (Hot/A-Z): solo admin.
  const adultInSearch = !!session;
  const adultInLists = isAdmin(session?.user?.email);

  const params = await searchParams;
  const query = params.search?.trim();
  const tab = params.tab === "az" ? "az" : "hot";
  const page = Math.max(1, Number(params.page) || 1);

  let mangas: any[];
  let pageInfo: { hasNextPage: boolean } | null = null;

  if (query) {
    mangas = await searchMangaList(query, adultInSearch);
  } else if (tab === "az") {
    const res = await getMangaPage(page, adultInLists);
    mangas = res.media;
    pageInfo = res.pageInfo;
  } else {
    mangas = await getTrendingManga(adultInLists);
  }

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
        <div className="mt-8 mb-4 flex gap-2">
          <Tab href="/?tab=hot" active={tab === "hot"}>
            🔥 Hot esta semana
          </Tab>
          <Tab href="/?tab=az" active={tab === "az"}>
            A-Z
          </Tab>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {mangas.map((manga: any) => (
          <Link
            key={manga.id}
            href={`/manga/${manga.id}`}
            className="group overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent"
          >
            <div className="aspect-2/3 w-full overflow-hidden bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={manga.coverImage.large}
                alt={manga.title.romaji}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            </div>
            <div className="p-3">
              <h3 className="truncate text-sm font-semibold" title={manga.title.romaji}>
                {manga.title.romaji}
              </h3>
              <p className="mt-1 truncate text-xs text-muted">
                {manga.title.native}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {!query && tab === "az" && pageInfo && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {page > 1 ? (
            <Link
              href={`/?tab=az&page=${page - 1}`}
              className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
            >
              ← Anterior
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-4 py-2 text-sm text-muted opacity-40">
              ← Anterior
            </span>
          )}
          <span className="text-sm text-muted">Página {page}</span>
          {pageInfo.hasNextPage ? (
            <Link
              href={`/?tab=az&page=${page + 1}`}
              className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
            >
              Siguiente →
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-4 py-2 text-sm text-muted opacity-40">
              Siguiente →
            </span>
          )}
        </div>
      )}
    </main>
  );
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
