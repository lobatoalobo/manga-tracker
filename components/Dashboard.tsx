import Link from "next/link";
import { getCollectionItems } from "@/lib/collection";
import { getShoppingCount } from "@/lib/shopping";
import { getPurchaseStats } from "@/lib/purchases";
import { displayTitle } from "@/lib/title";
import { seriesHref } from "@/lib/url";

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/** Dashboard personal del home (usuario logueado): tu colección de un vistazo. */
export default async function Dashboard({
  userId,
  name,
}: {
  userId: string;
  name?: string | null;
}) {
  const [items, shopping, stats] = await Promise.all([
    getCollectionItems(userId),
    getShoppingCount(userId),
    getPurchaseStats(userId),
  ]);

  // "Continuar": ediciones empezadas pero incompletas, las más cerca de terminar.
  const inProgress = items
    .filter(
      (i) =>
        i.edition.totalVolumes > 0 &&
        i.edition.ownedVolumes.length > 0 &&
        i.edition.ownedVolumes.length < i.edition.totalVolumes,
    )
    .map((i) => ({ i, missing: i.edition.totalVolumes - i.edition.ownedVolumes.length }))
    .sort((a, b) => a.missing - b.missing)
    .slice(0, 4);

  return (
    <main className="mx-auto max-w-6xl px-5 pb-12 pt-4">
      <h1 className="text-2xl font-bold">
        Hola{name ? `, ${name.split(" ")[0]}` : ""} 👋
      </h1>

      {/* Hero: te faltan N tomos */}
      <Link
        href="/faltantes"
        className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-5 transition hover:border-accent"
      >
        <div>
          <p className="text-sm text-muted">Para completar tu colección</p>
          <p className="mt-0.5 text-2xl font-bold">
            Te faltan {shopping.tomos} tomos
          </p>
          {shopping.series > 0 && (
            <p className="text-sm text-muted">en {shopping.series} series</p>
          )}
        </div>
        <span className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">
          Comprar →
        </span>
      </Link>

      {/* Resumen */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Series" value={String(new Set(items.map((i) => i.anilistId)).size)} href="/collection" />
        <Stat
          label="Tomos"
          value={String(
            items.reduce((s, i) => s + i.edition.ownedVolumes.length, 0),
          )}
          href="/collection"
        />
        <Stat label="Este mes" value={ars.format(stats.thisMonth)} href="/compras" />
      </div>

      {/* Continuar colección */}
      {inProgress.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Continuar colección</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {inProgress.map(({ i, missing }) => {
              const owned = i.edition.ownedVolumes.length;
              const total = i.edition.totalVolumes;
              const pct = Math.floor((owned / total) * 100);
              return (
                <Link
                  key={`${i.anilistId}-${i.edition.key}`}
                  href={seriesHref(i.anilistId)}
                  className="overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent"
                >
                  <div className="aspect-2/3 w-full bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={i.coverImage}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-medium">
                      {displayTitle(i.title)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {owned}/{total} · faltan {missing}
                    </p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Descubrir */}
      <section className="mt-8">
        <Link
          href="/catalogo?tab=series"
          className="flex items-center justify-between rounded-xl border border-border bg-surface px-5 py-4 transition hover:border-accent"
        >
          <span className="font-medium">🔜 Descubrir series nuevas</span>
          <span className="text-muted">→</span>
        </Link>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-surface p-4 transition hover:border-accent"
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </Link>
  );
}
