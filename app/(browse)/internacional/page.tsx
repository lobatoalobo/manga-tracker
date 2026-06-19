import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { browseWorks } from "@/lib/catalog";
import CatalogBrowser, {
  type BrowseCard,
  type BrowseState,
} from "@/components/CatalogBrowser";

export const metadata = {
  title: "Internacional · Nakama",
  description: "Catálogo de ediciones en inglés (VIZ Media).",
};

/**
 * Catálogo INTERNACIONAL (ediciones extranjeras, MVP = VIZ en inglés). Separado
 * del catálogo nacional: mismas obras `Work` pero filtradas por edición VIZ.
 * Reusa el browser del catálogo sin las pestañas de próximos (son de Ivrea).
 * Ver docs/plan-viz-en.md.
 */
export default async function InternacionalPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
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
    tab: "az",
    genres: split(sp.genres ?? sp.genre),
    gmode: sp.gmode === "all" ? "all" : "any",
    demographics: split(sp.demo),
    page: Math.max(1, Number(sp.page) || 1),
  };
  const session = await auth();
  const { items } = await browseWorks({ scope: "intl", take: 10000 });
  const cards: BrowseCard[] = items.map((w) => ({
    id: w.id,
    title: w.title,
    coverImage: w.coverImage,
    publishers: w.publishers,
    national: false,
    intl: true,
    upcoming: false,
    releaseLabel: w.releaseLabel,
    genres: w.genres,
    demographic: w.demographic,
    next: null,
  }));

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
      <h1 className="mb-1 text-2xl font-bold">Internacional</h1>
      <p className="mb-4 text-sm text-muted">
        Ediciones en inglés (VIZ Media). Seguí y coleccioná tus tomos igual que
        en el catálogo nacional.
      </p>
      <CatalogBrowser
        cards={cards}
        collected={collected}
        wished={wished}
        canWish={!!session?.user?.id}
        initial={initial}
        basePath="/internacional"
        showTabs={false}
        emptyPublisher="VIZ Media"
      />
    </main>
  );
}
