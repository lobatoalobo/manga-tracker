import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getWishlist } from "@/lib/wishlist";
import { nationalEditionIds } from "@/lib/getMangaDetails";
import { nationalCoversByAnilist } from "@/lib/catalog";
import { crumbSearch } from "@/lib/crumb";
import { seriesHref } from "@/lib/url";
import RemoveWishButton from "@/components/RemoveWishButton";

export const metadata = { title: "Deseados · Nakama" };

export default async function DeseadosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const items = await getWishlist(session.user.id);
  const nationalIds = await nationalEditionIds(items.map((w) => w.anilistId));
  const nationalCovers = await nationalCoversByAnilist(
    items.map((w) => w.anilistId),
  ).catch(() => new Map<number, string>());

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Deseados</h1>
      <p className="mb-6 text-sm text-muted">Lo que querés comprar.</p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="text-muted">Todavía no agregaste deseados.</p>
          <Link
            href="/"
            className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Buscar mangas
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((w) => (
            <div
              key={w.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent"
            >
              <RemoveWishButton anilistId={w.anilistId} />
              <Link href={seriesHref(w.anilistId)} className="block">
                <div className="aspect-2/3 w-full overflow-hidden bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={nationalCovers.get(w.anilistId) ?? w.coverImage}
                    alt={w.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
                <div className="p-3">
                  <h3 className="truncate text-sm font-semibold" title={w.title}>
                    {w.title}
                  </h3>
                </div>
              </Link>
              {nationalIds.has(w.anilistId) && (
                <a
                  href={crumbSearch(w.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block border-t border-border px-3 py-2 text-center text-xs text-accent transition hover:bg-accent/10"
                >
                  🛒 Comprar en Crumb
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
