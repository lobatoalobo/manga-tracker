import Link from "next/link";
import RemoveEditionButton from "@/components/RemoveEditionButton";
import type { CollectionItem } from "@/lib/collection";

export default function MangaCard({
  item,
  readOnly = false,
  hrefBase = "/manga",
}: {
  item: CollectionItem;
  readOnly?: boolean;
  hrefBase?: string;
}) {
  const { edition } = item;
  const owned = edition.ownedVolumes.length;
  const total = edition.totalVolumes;
  const pct = total > 0 ? Math.floor((owned / total) * 100) : 0;
  const isComplete = edition.status === "COMPLETED";

  return (
    <div className="group relative w-full overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent">
      {!readOnly && (
        <RemoveEditionButton
          anilistId={item.anilistId}
          editionKey={edition.key}
          label="Quitar"
          className="absolute right-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-xs text-muted opacity-0 backdrop-blur transition hover:text-red-400 group-hover:opacity-100"
        />
      )}

      <Link href={`${hrefBase}/${item.anilistId}`} className="block">
        <div className="aspect-2/3 w-full overflow-hidden bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.coverImage}
            alt={item.title.romaji}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        </div>

        <div className="p-3">
          <h3 className="truncate text-sm font-semibold" title={item.title.romaji}>
            {item.title.romaji}
          </h3>

          <p className="mt-0.5 truncate text-xs text-accent">{edition.label}</p>

          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {owned} / {total || "?"}
            </span>
            <span>{pct}%</span>
          </div>

          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{isComplete ? "🟩 Completado" : "🟨 En progreso"}</span>
            {edition.readingStatus === "READING" && (
              <span className="text-accent">
                📖 Leyendo
                {edition.readingVolume ? ` · #${edition.readingVolume}` : ""}
              </span>
            )}
            {edition.readingStatus === "READ" && <span>✅ Leído</span>}
          </div>
        </div>
      </Link>
    </div>
  );
}
