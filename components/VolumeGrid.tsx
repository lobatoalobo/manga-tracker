"use client";

import { useState, useTransition } from "react";
import { toggleVolumeAction } from "@/app/actions";

export default function VolumeGrid({
  mangaId,
  totalVolumes,
  ownedVolumes,
  onChange,
}: {
  mangaId: number;
  totalVolumes: number;
  ownedVolumes: number[];
  onChange?: (volumes: number[]) => void;
}) {
  const [owned, setOwned] = useState(ownedVolumes);
  const [, startTransition] = useTransition();

  function toggle(volume: number) {
    const updated = owned.includes(volume)
      ? owned.filter((v) => v !== volume)
      : [...owned, volume].sort((a, b) => a - b);

    // Actualización optimista.
    setOwned(updated);
    onChange?.(updated);

    startTransition(async () => {
      await toggleVolumeAction(mangaId, volume);
    });
  }

  if (totalVolumes <= 0) {
    return (
      <p className="text-sm text-muted">
        Todavía no conocemos la cantidad de tomos de esta serie.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2">
      {Array.from({ length: totalVolumes }, (_, i) => i + 1).map((volume) => {
        const isOwned = owned.includes(volume);

        return (
          <button
            key={volume}
            onClick={() => toggle(volume)}
            title={isOwned ? `Tenés el tomo ${volume}` : `Falta el tomo ${volume}`}
            className={`aspect-square rounded-md border text-sm font-semibold transition ${
              isOwned
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface-2 text-muted hover:border-accent hover:text-foreground"
            }`}
          >
            {volume}
          </button>
        );
      })}
    </div>
  );
}
