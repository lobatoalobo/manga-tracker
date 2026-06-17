import { browseWorks } from "@/lib/catalog";
import CatalogBrowser, { type BrowseCard } from "@/components/CatalogBrowser";

export const metadata = { title: "Catálogo · Nakama" };

/**
 * Browse/búsqueda del catálogo LOCAL (`Work`), sin AniList. Carga todas las obras
 * de una y delega el filtrado (texto + tabs) al cliente, para que la búsqueda sea
 * INSTANTÁNEA (sin round-trip por tecla).
 */
export default async function CatalogoPage() {
  const { items } = await browseWorks({ tab: "az", take: 10000 });
  const cards: BrowseCard[] = items.map((w) => ({
    id: w.id,
    title: w.title,
    coverImage: w.coverImage,
    publishers: w.publishers,
    upcoming: w.upcoming,
    releaseLabel: w.releaseLabel,
    next: w.next ? { volume: w.next.volume, date: w.next.date.toISOString() } : null,
  }));

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-bold">Catálogo</h1>
      <CatalogBrowser cards={cards} />
    </main>
  );
}
