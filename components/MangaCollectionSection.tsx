"use client";

import { useState, useTransition } from "react";
import VolumeGrid from "./VolumeGrid";
import RemoveButton from "./RemoveButton";
import ReadingControl from "./ReadingControl";
import { getTotalVolumes } from "@/lib/getTotalVolumes";
import { toggleVolumeAction, setAllVolumesAction } from "@/app/actions";
import type { MangaView } from "@/lib/collection";

export default function MangaCollectionSection({
  manga,
}: {
  manga: MangaView;
}) {
  const [owned, setOwned] = useState<number[]>(manga.ownedVolumes ?? []);
  const [, startTransition] = useTransition();

  const total = getTotalVolumes(manga);
  const ownedCount = owned.length;
  const percentage = total > 0 ? Math.floor((ownedCount / total) * 100) : 0;

  const missing =
    total > 0
      ? Array.from({ length: total }, (_, i) => i + 1).filter(
          (v) => !owned.includes(v),
        )
      : null;

  const allOwned = total > 0 && ownedCount >= total;

  function toggle(volume: number) {
    setOwned((prev) =>
      prev.includes(volume)
        ? prev.filter((v) => v !== volume)
        : [...prev, volume].sort((a, b) => a - b),
    );
    startTransition(() => toggleVolumeAction(manga.id, volume));
  }

  function setAll(value: boolean) {
    setOwned(value ? Array.from({ length: total }, (_, i) => i + 1) : []);
    startTransition(() => setAllVolumesAction(manga.id, value));
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent">
            ✓ En tu colección
          </span>
          {manga.publisher && (
            <p className="mt-2 text-sm text-muted">
              Trackeando:{" "}
              <span className="text-foreground">{manga.publisher}</span>
            </p>
          )}
        </div>
        <RemoveButton id={manga.id} />
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            {ownedCount} / {total} tomos
          </span>
          <span className="text-muted">{percentage}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      <p className="mt-3 text-sm text-muted">
        <span className="font-medium text-foreground">Faltan:</span>{" "}
        {missing === null
          ? "cantidad desconocida"
          : missing.length > 0
            ? missing.join(", ")
            : "¡colección completa! 🎉"}
      </p>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tomos</h2>
        {total > 0 && (
          <button
            onClick={() => setAll(!allOwned)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent"
          >
            {allOwned ? "Limpiar todos" : "Tengo todos"}
          </button>
        )}
      </div>

      <div className="mt-3">
        <VolumeGrid totalVolumes={total} owned={owned} onToggle={toggle} />
      </div>

      <ReadingControl
        mangaId={manga.id}
        total={total}
        initialStatus={manga.readingStatus}
        initialVolume={manga.readingVolume}
      />
    </section>
  );
}
