"use client";

export default function VolumeGrid({
  totalVolumes,
  owned,
  onToggle,
}: {
  totalVolumes: number;
  owned: number[];
  onToggle: (volume: number) => void;
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

        return (
          <button
            key={volume}
            onClick={() => onToggle(volume)}
            title={
              isOwned ? `Tenés el tomo ${volume}` : `Falta el tomo ${volume}`
            }
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
