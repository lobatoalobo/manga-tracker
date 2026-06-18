import Link from "next/link";
import RemoveEditionButton from "@/components/RemoveEditionButton";
import FavoriteButton from "@/components/FavoriteButton";
import { displayTitle } from "@/lib/title";
import { editionProgress } from "@/services/collectionService";
import type { CollectionItem } from "@/lib/collection";

export default function MangaCard({
  item,
  readOnly = false,
  hrefBase = "/manga",
  isFavorite = false,
}: {
  item: CollectionItem;
  readOnly?: boolean;
  hrefBase?: string;
  isFavorite?: boolean;
}) {
  const { edition } = item;
  const title = displayTitle(item.title);
  const prog = editionProgress(edition);
  const { owned, total, read, status } = prog;
  const pct = prog.ownedPct;
  // Las obras locales (sin AniList) usan un id negativo (-workId) y viven en /serie.
  const href =
    item.anilistId < 0
      ? `/serie/${-item.anilistId}`
      : `${hrefBase}/${item.anilistId}`;

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-xl border bg-surface transition hover:border-accent ${
        isFavorite ? "border-amber-400 ring-1 ring-amber-400/50" : "border-border"
      }`}
    >
      {!readOnly && (
        <>
          <FavoriteButton
            anilistId={item.anilistId}
            isFavorite={isFavorite}
            className={`absolute left-2 top-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-sm backdrop-blur transition disabled:opacity-50 ${
              isFavorite ? "text-amber-400" : "text-white/80 hover:text-amber-400"
            }`}
          />
          <RemoveEditionButton
            anilistId={item.anilistId}
            editionKey={edition.key}
            label="Quitar"
            className="absolute right-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-xs text-muted opacity-0 backdrop-blur transition hover:text-red-400 group-hover:opacity-100"
          />
        </>
      )}

      <Link href={href} className="block">
        <div className="relative aspect-2/3 w-full overflow-hidden bg-surface-2">
          {item.upcoming && (
            <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
              🔜 Pronto
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.coverImage}
            alt={title}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        </div>

        <div className="p-3">
          <h3 className="truncate text-sm font-semibold" title={title}>
            {title}
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
              className={`h-full rounded-full ${
                status === "al-dia" ? "bg-emerald-500" : "bg-amber-400/80"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {status === "al-dia" ? (
              <span className="text-emerald-400">✓ Al día</span>
            ) : status === "incompleta" ? (
              <span className="text-amber-400/90">Faltan {total - owned}</span>
            ) : null}
            {read > 0 && (
              <span className="text-muted tabular-nums">· leídos {read}/{total || "?"}</span>
            )}
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
