"use client";

export default function VolumeGrid({
  totalVolumes,
  owned,
  onToggle,
  readOnly = false,
}: {
  totalVolumes: number;
  owned: number[];
  onToggle?: (volume: number) => void;
  readOnly?: boolean;
}) {
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
        const cls = `aspect-square rounded-md border text-sm font-semibold ${
          isOwned
            ? "border-accent bg-accent text-white"
            : "border-border bg-surface-2 text-muted"
        }`;

        if (readOnly) {
          return (
            <div
              key={volume}
              className={`${cls} flex items-center justify-center`}
            >
              {volume}
            </div>
          );
        }

        return (
          <button
            key={volume}
            onClick={() => onToggle?.(volume)}
            title={
              isOwned ? `Tenés el tomo ${volume}` : `Falta el tomo ${volume}`
            }
            className={`${cls} cursor-pointer transition hover:border-accent`}
          >
            {volume}
          </button>
        );
      })}
    </div>
  );
}
