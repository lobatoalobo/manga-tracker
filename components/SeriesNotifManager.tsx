"use client";

import { useState, useTransition } from "react";
import { setSeriesMutedAction } from "@/app/actions";

type Serie = { anilistId: number; title: string; coverImage: string; muted: boolean };

/** Gestión en lote del muteo por serie: lista + buscador + campanita por fila. */
export default function SeriesNotifManager({ series }: { series: Serie[] }) {
  const [q, setQ] = useState("");
  const [muted, setMuted] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(series.map((s) => [s.anilistId, s.muted])),
  );
  const [pending, start] = useTransition();

  const filtered = q
    ? series.filter((s) => s.title.toLowerCase().includes(q.toLowerCase()))
    : series;

  function toggle(id: number) {
    const value = !muted[id];
    setMuted((m) => ({ ...m, [id]: value })); // optimista
    start(() => setSeriesMutedAction(id, value));
  }

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar serie…"
        className="mb-3 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {filtered.map((s) => {
          const isMuted = muted[s.anilistId];
          return (
            <li key={s.anilistId} className="flex items-center gap-3 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.coverImage}
                alt=""
                className="h-12 w-9 shrink-0 rounded object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
              <button
                type="button"
                onClick={() => toggle(s.anilistId)}
                disabled={pending}
                aria-pressed={!isMuted}
                title={isMuted ? "Silenciada — activar" : "Notis activas — silenciar"}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                  isMuted
                    ? "border-border text-muted hover:text-foreground"
                    : "border-accent/50 text-accent hover:bg-accent/10"
                }`}
              >
                {isMuted ? "🔕" : "🔔"}
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && (
        <p className="mt-4 text-sm text-muted">Ninguna serie coincide.</p>
      )}
    </>
  );
}
