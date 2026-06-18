import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getWishlist } from "@/lib/wishlist";
import { nationalEditionIds } from "@/lib/getMangaDetails";
import { nationalCoversByAnilist, upcomingForIds } from "@/lib/catalog";
import { seriesHref } from "@/lib/url";
import RemoveWishButton from "@/components/RemoveWishButton";
import SeriesTile from "@/components/SeriesTile";

export const metadata = { title: "Deseados · Nakama" };

export default async function DeseadosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const items = await getWishlist(session.user.id);
  const nationalIds = await nationalEditionIds(items.map((w) => w.anilistId));
  const nationalCovers = await nationalCoversByAnilist(
    items.map((w) => w.anilistId),
  ).catch(() => new Map<number, string>());
  const upcoming = await upcomingForIds(items.map((w) => w.anilistId)).catch(
    () => new Set<number>(),
  );

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Deseados</h1>
      <p className="mb-4 text-sm text-muted">Lo que querés comprar.</p>

      {items.length > 0 && (
        <p className="mb-6 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground">
          📬 Te avisamos cuando alguna de estas series{" "}
          <span className="font-medium">salga en Argentina</span> o cuando se{" "}
          <span className="font-medium">reedite un tomo</span> que te falta.
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="text-muted">Todavía no agregaste deseados.</p>
          <Link
            href="/catalogo"
            className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Buscar mangas
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((w) => (
            <SeriesTile
              key={w.id}
              data={{
                href: seriesHref(w.anilistId),
                title: w.title,
                coverImage: nationalCovers.get(w.anilistId) ?? w.coverImage,
                national: nationalIds.has(w.anilistId),
                upcoming: upcoming.has(w.anilistId),
              }}
              overlay={<RemoveWishButton anilistId={w.anilistId} />}
            />
          ))}
        </div>
      )}
    </main>
  );
}
