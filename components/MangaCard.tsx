import Link from "next/link";
import { getMangaStats } from "@/lib/mangaStats";
import RemoveButton from "@/components/RemoveButton";
import type { MangaView } from "@/lib/collection";

export default function MangaCard({ manga }: { manga: MangaView }) {
  const stats = getMangaStats(manga);
  const isComplete = manga.status === "COMPLETED";

  return (
    <div className="group relative w-full overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent">
      <RemoveButton
        id={manga.id}
        className="absolute right-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-xs text-muted opacity-0 backdrop-blur transition hover:text-red-400 group-hover:opacity-100"
      />

      <Link href={`/manga/${manga.id}`} className="block">
        <div className="aspect-2/3 w-full overflow-hidden bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={manga.coverImage}
            alt={manga.title.romaji}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        </div>

        <div className="p-3">
          <h3 className="truncate text-sm font-semibold" title={manga.title.romaji}>
            {manga.title.romaji}
          </h3>

          {manga.publisher && (
            <p className="mt-0.5 truncate text-xs text-accent">
              {manga.publisher}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {stats.owned} / {stats.total || "?"}
            </span>
            <span>{stats.percentage}%</span>
          </div>

          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${stats.percentage}%` }}
            />
          </div>

          <span className="mt-2 inline-block text-xs">
            {isComplete ? "🟩 Completado" : "🟨 En progreso"}
          </span>
        </div>
      </Link>
    </div>
  );
}
