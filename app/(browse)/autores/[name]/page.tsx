import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { browseWorks, wishEditionsFor } from "@/lib/catalog";
import CatalogBrowser, {
  type BrowseCard,
  type BrowseState,
} from "@/components/CatalogBrowser";

export const metadata = { title: "Autor · Nakama" };

/**
 * Obras de un autor del catálogo LOCAL (match por `Work.author`). Reusa el mismo
 * pipeline que el catálogo (`CatalogBrowser`): cards con corazón (desear por
 * edición) + chips de próximo tomo / reedición. Sin tabs ni buscador.
 */
export default async function AutorPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const author = decodeURIComponent(name);
  const { items } = await browseWorks({ tab: "az", take: 10000, author });
  if (items.length === 0) notFound();

  const cards: BrowseCard[] = items.map((w) => ({
    id: w.id,
    title: w.title,
    coverImage: w.coverImage,
    publishers: w.publishers,
    national: w.national,
    intl: w.intl,
    upcoming: w.upcoming,
    releaseLabel: w.releaseLabel,
    genres: w.genres,
    demographic: w.demographic,
    maxVolumes: w.maxVolumes,
    finished: w.finished,
    next: w.next ? { volume: w.next.volume, date: w.next.date.toISOString() } : null,
    reissue: w.reissue
      ? { volume: w.reissue.volume, date: w.reissue.date.toISOString() }
      : null,
    editions: wishEditionsFor(w.publishers, w.national),
  }));

  // Obras que el usuario ya colecciona / desea (anilistId negativo = -workId).
  const session = await auth();
  let collected: number[] = [];
  const wishedMap: Record<number, string[]> = {};
  if (session?.user?.id) {
    const [mangas, wishes] = await Promise.all([
      prisma.manga.findMany({
        where: { userId: session.user.id, anilistId: { lt: 0 } },
        select: { anilistId: true },
      }),
      prisma.wishlistItem.findMany({
        where: { userId: session.user.id, anilistId: { lt: 0 } },
        select: { anilistId: true, editionKey: true },
      }),
    ]);
    collected = mangas.map((r) => -r.anilistId);
    for (const w of wishes) (wishedMap[-w.anilistId] ??= []).push(w.editionKey);
  }

  const initial: BrowseState = {
    q: "",
    tab: "az",
    region: "all",
    pubs: [],
    sort: "az",
    completed: false,
    genres: [],
    gmode: "any",
    demographics: [],
    page: 1,
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <Link href="/autores" className="text-sm text-muted hover:text-foreground">
        ← Autores
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">{author}</h1>
      <p className="mb-5 text-sm text-muted">
        {cards.length} {cards.length === 1 ? "obra" : "obras"}
      </p>
      <CatalogBrowser
        cards={cards}
        collected={collected}
        wishedMap={wishedMap}
        canWish={!!session?.user?.id}
        initial={initial}
        basePath={`/autores/${encodeURIComponent(author)}`}
        showTabs={false}
        showSearch={false}
        showGenreFilters={false}
      />
    </main>
  );
}
