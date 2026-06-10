import { notFound } from "next/navigation";
import { getPublicCollection } from "@/lib/collection";
import CollectionGrid from "@/components/CollectionGrid";
import { getCollectionStats } from "@/services/collectionService";

export const metadata = {
  title: "Colección · Nakama",
};

export default async function PublicCollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicCollection(slug);
  if (!data) notFound();

  const stats = getCollectionStats(data.items);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <p className="text-sm text-muted">Colección de</p>
      <h1 className="mb-6 text-2xl font-bold">{data.name}</h1>

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

      <CollectionGrid items={data.items} readOnly hrefBase={`/u/${slug}`} />
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
