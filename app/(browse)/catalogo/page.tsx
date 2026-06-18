import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { browseWorks } from "@/lib/catalog";
import CatalogBrowser, {
  type BrowseCard,
  type BrowseState,
} from "@/components/CatalogBrowser";

export const metadata = { title: "Catálogo · Nakama" };

/**
 * Browse/búsqueda del catálogo LOCAL (`Work`), sin AniList. Carga todas las obras
 * de una y delega el filtrado (texto + tabs + género) al cliente, instantáneo. El
 * estado inicial sale de la URL (searchParams) para que los deep-links funcionen.
 */
export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tab?: string;
    genre?: string;
    genres?: string;
    gmode?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const initial: BrowseState = {
    q: sp.q ?? "",
    tab: sp.tab === "series" || sp.tab === "tomos" ? sp.tab : "az",
    genres: (sp.genres ?? sp.genre ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    gmode: sp.gmode === "all" ? "all" : "any",
    page: Math.max(1, Number(sp.page) || 1),
  };
  const session = await auth();
  const { items } = await browseWorks({ tab: "az", take: 10000 });
  const cards: BrowseCard[] = items.map((w) => ({
    id: w.id,
    title: w.title,
    coverImage: w.coverImage,
    publishers: w.publishers,
    national: w.national,
    upcoming: w.upcoming,
    releaseLabel: w.releaseLabel,
    genres: w.genres,
    next: w.next ? { volume: w.next.volume, date: w.next.date.toISOString() } : null,
  }));

  // Obras que el usuario ya colecciona / desea (Manga y WishlistItem con
  // anilistId negativo = -workId), para resaltarlas en la grilla.
  let collected: number[] = [];
  let wished: number[] = [];
  if (session?.user?.id) {
    const [mangas, wishes] = await Promise.all([
      prisma.manga.findMany({
        where: { userId: session.user.id, anilistId: { lt: 0 } },
        select: { anilistId: true },
      }),
      prisma.wishlistItem.findMany({
        where: { userId: session.user.id, anilistId: { lt: 0 } },
        select: { anilistId: true },
      }),
    ]);
    collected = mangas.map((r) => -r.anilistId);
    wished = wishes.map((r) => -r.anilistId);
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-bold">Catálogo</h1>
      <CatalogBrowser
        cards={cards}
        collected={collected}
        wished={wished}
        canWish={!!session?.user?.id}
        initial={initial}
      />
    </main>
  );
}
