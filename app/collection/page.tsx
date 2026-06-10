import { getCollection } from "@/lib/collection";
import CollectionGrid from "@/components/CollectionGrid";
import { getCollectionStats } from "@/services/collectionService";

export const metadata = {
  title: "Mi colección · Manga Tracker",
};

export default async function CollectionPage() {
  const collection = await getCollection();
  const stats = getCollectionStats(collection);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Mi colección</h1>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Series" value={stats.mangas} />
        <Stat label="Tomos" value={`${stats.ownedVolumes} / ${stats.totalVolumes}`} />
        <Stat label="Progreso" value={`${stats.percentage}%`} />
        <div className="col-span-2 flex flex-col justify-center rounded-xl border border-border bg-surface p-4 sm:col-span-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${stats.percentage}%` }}
            />
          </div>
        </div>
      </div>

      <CollectionGrid collection={collection} />
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
