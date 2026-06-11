"use client";

import { useState, useTransition } from "react";
import VolumeGrid from "./VolumeGrid";
import ReadingControl from "./ReadingControl";
import {
  toggleVolumeAction,
  setAllVolumesAction,
  removeEditionAction,
} from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";
import type { EditionView, ReadingStatus } from "@/lib/collection";

export default function TrackingPanel({
  anilistId,
  title,
  editions: initial,
}: {
  anilistId: number;
  title: string;
  editions: EditionView[];
}) {
  const [editions, setEditions] = useState<EditionView[]>(initial);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    initial[0]?.key,
  );
  const [, startTransition] = useTransition();

  const sel = editions.find((e) => e.key === selectedKey) ?? editions[0];
  if (!sel) return null;

  function patch(key: string, fn: (e: EditionView) => EditionView) {
    setEditions((prev) => prev.map((e) => (e.key === key ? fn(e) : e)));
  }

  function toggle(volume: number) {
    patch(sel.key, (e) => ({
      ...e,
      ownedVolumes: e.ownedVolumes.includes(volume)
        ? e.ownedVolumes.filter((v) => v !== volume)
        : [...e.ownedVolumes, volume].sort((a, b) => a - b),
    }));
    startTransition(() => toggleVolumeAction(anilistId, sel.key, volume));
  }

  function setAll(value: boolean) {
    patch(sel.key, (e) => ({
      ...e,
      ownedVolumes: value
        ? Array.from({ length: e.totalVolumes }, (_, i) => i + 1)
        : [],
    }));
    startTransition(() => setAllVolumesAction(anilistId, sel.key, value));
  }

  function onReading(status: ReadingStatus, volume: number | null) {
    patch(sel.key, (e) => ({ ...e, readingStatus: status, readingVolume: volume }));
  }

  function untrack(key: string) {
    setEditions((prev) => {
      const next = prev.filter((e) => e.key !== key);
      if (selectedKey === key) setSelectedKey(next[0]?.key);
      return next;
    });
    startTransition(() => removeEditionAction(anilistId, key));
  }

  const owned = sel.ownedVolumes.length;
  const total = sel.totalVolumes;
  const pct = total > 0 ? Math.floor((owned / total) * 100) : 0;
  const missing =
    total > 0
      ? Array.from({ length: total }, (_, i) => i + 1).filter(
          (v) => !sel.ownedVolumes.includes(v),
        )
      : [];
  const allOwned = total > 0 && owned >= total;

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Mis tomos</h2>

      {/* Selector de edición (si hay más de una trackeada) */}
      {editions.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {editions.map((e) => (
            <button
              key={e.key}
              onClick={() => setSelectedKey(e.key)}
              className={`rounded-full px-3 py-1 text-sm transition ${
                e.key === sel.key
                  ? "bg-accent text-white"
                  : "border border-border text-muted hover:text-foreground"
              }`}
            >
              {e.label}{" "}
              <span className="opacity-70">
                {e.ownedVolumes.length}/{e.totalVolumes}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">{sel.label}</span>
        <button
          onClick={() => untrack(sel.key)}
          className="text-xs text-muted transition hover:text-red-400"
        >
          Dejar de trackear
        </button>
      </div>

      <div className="mt-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            {owned} / {total} tomos
          </span>
          <span className="text-muted">{pct}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <p className="mt-3 text-sm text-muted">
        <span className="font-medium text-foreground">Faltan:</span>{" "}
        {total === 0
          ? "cantidad desconocida"
          : missing.length > 0
            ? missing.join(", ")
            : "¡colección completa! 🎉"}
      </p>

      {missing.length > 0 && (
        <a
          href={crumbSearch(title)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm text-accent hover:underline"
        >
          🛒 Conseguir los que faltan en Crumb
        </a>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h3 className="font-semibold">Tomos</h3>
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
        <VolumeGrid totalVolumes={total} owned={sel.ownedVolumes} onToggle={toggle} />
      </div>

      <ReadingControl
        anilistId={anilistId}
        editionKey={sel.key}
        total={total}
        status={sel.readingStatus}
        volume={sel.readingVolume}
        onChange={onReading}
      />
    </section>
  );
}
