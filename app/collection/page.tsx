import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getCollectionItems, getShareSlug, getFavoriteId } from "@/lib/collection";
import CollectionGrid from "@/components/CollectionGrid";
import ShareToggle from "@/components/ShareToggle";
import ImportExport from "@/components/ImportExport";
import { getCollectionStats } from "@/services/collectionService";

export const metadata = {
  title: "Mi colección · Nakama",
};

export default async function CollectionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [items, shareSlug, favoriteId] = await Promise.all([
    getCollectionItems(session.user.id),
    getShareSlug(session.user.id),
    getFavoriteId(session.user.id),
  ]);
  const stats = getCollectionStats(items);

  const faltan = items.filter(
    (i) =>
      i.edition.region === "AR" &&
      i.edition.totalVolumes > 0 &&
      i.edition.ownedVolumes.length < i.edition.totalVolumes,
  );
  const tomosFaltan = faltan.reduce(
    (s, i) => s + (i.edition.totalVolumes - i.edition.ownedVolumes.length),
    0,
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Mi colección</h1>

      <ShareToggle initialSlug={shareSlug} />

      <ImportExport />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Series" value={stats.series} />
        <Stat label="Ediciones" value={stats.editions} />
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Tomos</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {stats.ownedVolumes} / {stats.totalVolumes}
          </p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            leídos {stats.readVolumes} / {stats.ownedVolumes}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">
            Colección · {stats.percentage}%
          </p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${stats.percentage}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">Leído · {stats.readPercentage}%</p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${stats.readPercentage}%` }}
            />
          </div>
        </div>
      </div>

      {tomosFaltan > 0 && (
        <Link
          href="/faltantes"
          className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm transition hover:border-accent"
        >
          <span>
            🛒 Te faltan <b>{tomosFaltan}</b> tomos en <b>{faltan.length}</b>{" "}
            series.
          </span>
          <span className="shrink-0 font-medium text-accent">
            Para comprar →
          </span>
        </Link>
      )}

      <CollectionGrid items={items} favoriteId={favoriteId} />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
