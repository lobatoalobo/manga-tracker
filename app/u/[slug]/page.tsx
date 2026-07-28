import { notFound } from "next/navigation";
import { getPublicCollection } from "@/lib/collection";
import CollectionGrid from "@/components/CollectionGrid";
import { getCollectionStats, progressPercentage } from "@/services/collectionService";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<import("next").Metadata> {
  const { slug } = await params;
  const data = await getPublicCollection(slug);
  if (!data) return { title: "Colección" };
  const stats = getCollectionStats(data.items);
  const title = `Colección de ${data.name}`;
  // "Tomos poseídos" desde el read-side unificado (ADR-011, Slice 9 / CP7); el resto de stats sigue legado.
  const desc = `${stats.series} series y ${data.ownedVolumes} tomos. Mirá la colección de manga de ${data.name} en Nakama.`;
  // Portada representativa (la preferida, o la primera) como preview al compartir.
  const cover =
    data.items.find((i) => i.anilistId === data.favoriteId)?.coverImage ||
    data.items[0]?.coverImage;
  const images = cover ? [{ url: cover }] : undefined;
  return {
    title,
    description: desc,
    openGraph: { title: `${title} · Nakama`, description: desc, images },
    twitter: { title: `${title} · Nakama`, description: desc, images },
  };
}

export default async function PublicCollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicCollection(slug);
  if (!data) notFound();

  const stats = getCollectionStats(data.items);
  // Stat, metadata y barra comparten el MISMO numerador unificado (`data.ownedVolumes`); el denominador
  // (`totalVolumes`) sigue del camino legado. `progressPercentage` clampa a 100 solo para presentación.
  const percentage = progressPercentage(data.ownedVolumes, stats.totalVolumes);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <p className="text-sm text-muted">Colección de</p>
      <h1 className="mb-6 text-2xl font-bold">{data.name}</h1>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Series" value={stats.series} />
        <Stat label="Ediciones" value={stats.editions} />
        <Stat
          label="Tomos"
          value={`${data.ownedVolumes} / ${stats.totalVolumes}`}
        />
        <div className="flex flex-col justify-center rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Progreso · {percentage}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>

      <CollectionGrid
        items={data.items}
        readOnly
        hrefBase={`/u/${slug}`}
        favoriteId={data.favoriteId}
      />
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
