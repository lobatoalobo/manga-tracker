"use client";

import { useState } from "react";
import VolumeGrid from "./VolumeGrid";
import RemoveButton from "./RemoveButton";
import { getTotalVolumes } from "@/lib/getTotalVolumes";
import type { MangaView } from "@/lib/collection";

export default function MangaCollectionSection({
  manga,
}: {
  manga: MangaView;
}) {
  const [ownedVolumes, setOwnedVolumes] = useState<number[]>(
    manga.ownedVolumes ?? [],
  );

  const total = getTotalVolumes(manga);
  const owned = ownedVolumes.length;
  const percentage = total > 0 ? Math.floor((owned / total) * 100) : 0;

  const missing =
    total > 0
      ? Array.from({ length: total }, (_, i) => i + 1).filter(
          (v) => !ownedVolumes.includes(v),
        )
      : null;

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent">
            ✓ En tu colección
          </span>
          {manga.publisher && (
            <p className="mt-2 text-sm text-muted">
              Trackeando: <span className="text-foreground">{manga.publisher}</span>
            </p>
          )}
        </div>
        <RemoveButton id={manga.id} />
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            {owned} / {total} tomos
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

      <h2 className="mt-6 mb-3 text-lg font-semibold">Tomos</h2>

      <VolumeGrid
        mangaId={manga.id}
        totalVolumes={total}
        ownedVolumes={ownedVolumes}
        onChange={setOwnedVolumes}
      />
    </section>
  );
}
