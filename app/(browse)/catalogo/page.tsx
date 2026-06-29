import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  browseWorks,
  wishEditionsFor,
  INTL_PUBLISHERS,
  CATALOG_PUBLISHERS,
} from "@/lib/catalog";
import CatalogBrowser, {
  type BrowseCard,
  type BrowseState,
} from "@/components/CatalogBrowser";
import { isEnabled } from "@/lib/featureFlags";

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
    region?: string;
    pubs?: string;
    pub?: string;
    sort?: string;
    completed?: string;
    genre?: string;
    genres?: string;
    gmode?: string;
    demo?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const split = (v?: string) =>
    (v ?? "").split(",").map((g) => g.trim()).filter(Boolean);
  const initial: BrowseState = {
    q: sp.q ?? "",
    tab: sp.tab === "series" || sp.tab === "tomos" ? sp.tab : "az",
    region: sp.region === "ar" || sp.region === "int" ? sp.region : "all",
    pubs: split(sp.pubs ?? sp.pub),
    sort: (["az", "za", "vols-desc", "vols-asc"] as const).includes(sp.sort as never)
      ? (sp.sort as "az" | "za" | "vols-desc" | "vols-asc")
      : "none",
    completed: sp.completed === "1",
    genres: split(sp.genres ?? sp.genre),
    gmode: sp.gmode === "all" ? "all" : "any",
    demographics: split(sp.demo),
    page: Math.max(1, Number(sp.page) || 1),
  };
  const session = await auth();
  // Server-side: filtros + paginación en la query → se sirve UNA página (~60), no
  // ~1800 obras al cliente. Los controles del browser navegan por URL (re-consulta).
  const { items, total } = await browseWorks({
    q: initial.q,
    tab: initial.tab,
    region: initial.region,
    pubs: initial.pubs,
    genres: initial.genres,
    gmode: initial.gmode,
    demographics: initial.demographics,
    completed: initial.completed,
    sort: initial.sort === "za" ? "za" : initial.sort === "az" ? "az" : "none",
    page: initial.page,
    take: 60,
  });
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
    // Ediciones deseables (dedup por key); debut sin ediciones → nacional implícita.
    editions: wishEditionsFor(w.publishers, w.national),
  }));

  // Obras que el usuario ya colecciona / desea (Manga y WishlistItem con
  // anilistId negativo = -workId), para resaltarlas en la grilla.
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
    for (const w of wishes) {
      const id = -w.anilistId;
      (wishedMap[id] ??= []).push(w.editionKey);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-bold">Catálogo</h1>
      <CatalogBrowser
        cards={cards}
        total={total}
        collected={collected}
        wishedMap={wishedMap}
        canWish={!!session?.user?.id}
        initial={initial}
        showGenreFilters={await isEnabled("genre-filters")}
        intlPublishers={[...INTL_PUBLISHERS]}
        nationalPublishers={[...CATALOG_PUBLISHERS]}
      />
    </main>
  );
}
