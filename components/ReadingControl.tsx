"use client";

import { useTransition } from "react";
import { setReadingAction } from "@/app/actions";
import type { ReadingStatus } from "@/lib/collection";

const STATUSES: { key: ReadingStatus; label: string }[] = [
  { key: "UNREAD", label: "Sin empezar" },
  { key: "READING", label: "Leyendo" },
  { key: "READ", label: "Leído" },
];

export default function ReadingControl({
  anilistId,
  editionKey,
  total,
  status,
  volume,
  onChange,
}: {
  anilistId: number;
  editionKey: string;
  total: number;
  status: string;
  volume: number | null;
  onChange: (status: ReadingStatus, volume: number | null) => void;
}) {
  const [, startTransition] = useTransition();

  function persist(next: ReadingStatus, vol: number | null) {
    onChange(next, vol);
    startTransition(() => setReadingAction(anilistId, editionKey, next, vol));
  }

  function pickStatus(s: ReadingStatus) {
    const vol =
      s === "READ" ? total || null : s === "UNREAD" ? null : volume || 1;
    persist(s, vol);
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Lectura:</span>
        {STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => pickStatus(s.key)}
            className={`rounded-full px-3 py-1 text-sm transition ${
              status === s.key
                ? "bg-accent text-white"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {status === "READING" && (
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          Voy por el tomo
          <input
            type="number"
            min={1}
            max={total || undefined}
            value={volume ?? ""}
            onChange={(e) =>
              persist("READING", e.target.value ? Number(e.target.value) : null)
            }
            className="w-20 rounded-lg border border-border bg-surface-2 px-2 py-1 text-foreground outline-none focus:border-accent"
          />
          {total > 0 && <span>de {total}</span>}
        </label>
      )}
    </div>
  );
}
