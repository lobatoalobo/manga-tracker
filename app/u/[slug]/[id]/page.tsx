import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicSeries } from "@/lib/collection";
import { getMangaCore } from "@/lib/getMangaDetails";
import VolumeGrid from "@/components/VolumeGrid";

export const metadata = { title: "Colección · Manga Tracker" };

export default async function PublicSeriesPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const anilistId = Number(id);

  const [anilist, data] = await Promise.all([
    getMangaCore(anilistId),
    getPublicSeries(slug, anilistId),
  ]);

  if (!data) notFound();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link
        href={`/u/${slug}`}
        className="text-sm text-accent hover:underline"
      >
        ← Colección de {data.ownerName}
      </Link>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={anilist.coverImage}
          alt={anilist.title.romaji}
          className="h-72 w-48 shrink-0 self-start rounded-xl object-cover"
        />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{anilist.title.romaji}</h1>
          {anilist.title.native && (
            <p className="text-muted">{anilist.title.native}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {anilist.genres?.map((g: string) => (
              <span
                key={g}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      </div>

      {anilist.description && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {anilist.description}
        </p>
      )}

      <h2 className="mt-6 text-lg font-semibold">Ediciones</h2>
      <div className="mt-3 space-y-5">
        {data.series.editions.map((e) => {
          const owned = e.ownedVolumes.length;
          const pct =
            e.totalVolumes > 0 ? Math.floor((owned / e.totalVolumes) * 100) : 0;
          return (
            <div
              key={e.key}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{e.label}</span>
                <span className="text-sm text-muted">
                  {owned} / {e.totalVolumes} · {pct}%
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-4">
                <VolumeGrid
                  totalVolumes={e.totalVolumes}
                  owned={e.ownedVolumes}
                  readOnly
                />
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
