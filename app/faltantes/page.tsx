import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getShoppingList, getWishlistToBuy } from "@/lib/shopping";
import { seriesHref } from "@/lib/url";

export const metadata = { title: "Para comprar · Nakama" };

export default async function FaltantesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [items, wishlistBuy] = await Promise.all([
    getShoppingList(session.user.id),
    getWishlistToBuy(session.user.id),
  ]);
  const totalMissing = items.reduce((s, i) => s + i.missing.length, 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Para comprar</h1>
      <p className="mb-6 text-sm text-muted">
        Los tomos que te faltan de tus ediciones nacionales, con dónde
        comprarlos.
      </p>

      {items.length === 0 && wishlistBuy.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          ¡Estás al día! No te falta ningún tomo de tus ediciones nacionales 🎉
        </p>
      ) : (
        <>
          {items.length > 0 && (
          <>
          <p className="mb-4 text-sm text-muted">
            Te faltan <b className="text-foreground">{totalMissing}</b> tomos en{" "}
            <b className="text-foreground">{items.length}</b> series.
          </p>

          <ul className="space-y-3">
            {items.map((i) => (
              <li
                key={`${i.anilistId}-${i.publisher}`}
                className="flex gap-3 rounded-xl border border-border bg-surface p-3"
              >
                <Link href={seriesHref(i.anilistId)} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={i.coverImage}
                    alt={i.title}
                    className="h-24 w-16 rounded-md object-cover"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={seriesHref(i.anilistId)}
                    className="font-medium hover:text-accent"
                  >
                    {i.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {i.publisher} · tenés {i.owned}/{i.total}
                  </p>

                  <p className="mt-1.5 text-sm">
                    <span className="text-muted">Faltan {i.missing.length}: </span>
                    {i.missing.slice(0, 12).map((v) => (
                      <span
                        key={v}
                        className="mr-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 text-xs"
                      >
                        #{v}
                      </span>
                    ))}
                    {i.missing.length > 12 && (
                      <span className="text-xs text-muted">…</span>
                    )}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={i.crumbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-border px-3 py-1 text-xs transition hover:border-accent"
                    >
                      🛒 Crumb
                    </a>
                    <a
                      href={i.laRevisteriaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-border px-3 py-1 text-xs transition hover:border-accent"
                    >
                      🛒 La Revistería
                    </a>
                    {i.ovniUrl && (
                      <a
                        href={i.ovniUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-border px-3 py-1 text-xs transition hover:border-accent"
                      >
                        Ver en OvniPress ↗
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          </>
          )}

          {wishlistBuy.length > 0 && (
            <section className={items.length > 0 ? "mt-8" : ""}>
              <h2 className="mb-1 text-lg font-semibold">
                Deseados que ya salieron 🎉
              </h2>
              <p className="mb-4 text-sm text-muted">
                Series de tu lista de deseados ya disponibles en Argentina.
              </p>
              <ul className="space-y-3">
                {wishlistBuy.map((w) => (
                  <li
                    key={w.anilistId}
                    className="flex gap-3 rounded-xl border border-border bg-surface p-3"
                  >
                    <Link href={seriesHref(w.anilistId)} className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={w.coverImage}
                        alt={w.title}
                        className="h-24 w-16 rounded-md object-cover"
                      />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={seriesHref(w.anilistId)}
                        className="font-medium hover:text-accent"
                      >
                        {w.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted">
                        {w.publisher} · {w.total} {w.total === 1 ? "tomo" : "tomos"}
                      </p>
                      <div className="mt-2">
                        <a
                          href={w.crumbUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-border px-3 py-1 text-xs transition hover:border-accent"
                        >
                          🛒 Comprar en Crumb
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
