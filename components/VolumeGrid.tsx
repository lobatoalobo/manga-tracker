"use client";

import { useState } from "react";

const PER_PAGE = 21;

export default function VolumeGrid({
  totalVolumes,
  owned,
  onToggle,
  readOnly = false,
  paginate = false,
}: {
  totalVolumes: number;
  owned: number[];
  onToggle?: (volume: number) => void;
  readOnly?: boolean;
  paginate?: boolean;
}) {
  const [page, setPage] = useState(1);

  if (totalVolumes <= 0) {
    return (
      <p className="text-sm text-muted">
        Todavía no conocemos la cantidad de tomos de esta serie.
      </p>
    );
  }

  // Paginado de 21 (sin saltos: solo ← Página X de Y →).
  const pageCount = paginate ? Math.ceil(totalVolumes / PER_PAGE) : 1;
  const cur = Math.min(Math.max(1, page), pageCount);
  const start = paginate ? (cur - 1) * PER_PAGE + 1 : 1;
  const end = paginate ? Math.min(totalVolumes, cur * PER_PAGE) : totalVolumes;

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(42px,1fr))] gap-1.5">
        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(
          (volume) => {
            const isOwned = owned.includes(volume);
            const cls = `aspect-square rounded-md border text-xs font-semibold ${
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
          },
        )}
      </div>

      {paginate && pageCount > 1 && (
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          <button
            type="button"
            disabled={cur <= 1}
            onClick={() => setPage(cur - 1)}
            className="rounded-lg border border-border px-3 py-1 transition hover:border-accent disabled:opacity-40"
          >
            ←
          </button>
          <span className="tabular-nums text-muted">
            Página {cur} de {pageCount}
          </span>
          <button
            type="button"
            disabled={cur >= pageCount}
            onClick={() => setPage(cur + 1)}
            className="rounded-lg border border-border px-3 py-1 transition hover:border-accent disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
    </>
  );
}
