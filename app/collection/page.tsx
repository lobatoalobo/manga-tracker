import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCollectionItems, getShareSlug } from "@/lib/collection";
import CollectionGrid from "@/components/CollectionGrid";
import ShareToggle from "@/components/ShareToggle";
import { getCollectionStats } from "@/services/collectionService";

export const metadata = {
  title: "Mi colección · Nakama",
};

export default async function CollectionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [items, shareSlug] = await Promise.all([
    getCollectionItems(session.user.id),
    getShareSlug(session.user.id),
  ]);
  const stats = getCollectionStats(items);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Mi colección</h1>

      <ShareToggle initialSlug={shareSlug} />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Series" value={stats.series} />
        <Stat label="Ediciones" value={stats.editions} />
        <Stat
          label="Tomos"
          value={`${stats.ownedVolumes} / ${stats.totalVolumes}`}
        />
        <div className="flex flex-col justify-center rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Progreso · {stats.percentage}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${stats.percentage}%` }}
            />
          </div>
        </div>
      </div>

      <CollectionGrid items={items} />
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
