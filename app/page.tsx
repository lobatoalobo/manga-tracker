import { searchMangaList } from "@/lib/anilist";
import SearchBar from "@/components/SearchBar";
import Link from "next/link";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const params = await searchParams;
  const query = params.search?.trim() || "one piece";

  const mangas = await searchMangaList(query);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">📚 Manga Tracker</h1>
      <p className="mb-6 text-sm text-muted">
        Buscá un manga y agregalo a tu colección.
      </p>

      <SearchBar />

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
    </main>
  );
}
