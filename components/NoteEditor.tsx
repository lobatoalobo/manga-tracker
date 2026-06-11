"use client";

import { useState, useTransition } from "react";
import { setNoteAction } from "@/app/actions";

export default function NoteEditor({
  anilistId,
  initialRating,
  initialNote,
}: {
  anilistId: number;
  initialRating: number | null;
  initialNote: string | null;
}) {
  const [rating, setRating] = useState(initialRating ?? 0);
  const [note, setNote] = useState(initialNote ?? "");
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save() {
    setSaved(false);
    startTransition(async () => {
      await setNoteAction(anilistId, rating || null, note || null);
      setSaved(true);
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="mb-3 font-semibold">Tu reseña</h3>

      <label className="flex items-center gap-2 text-sm">
        Puntaje:
        <select
          value={rating}
          onChange={(e) => {
            setRating(Number(e.target.value));
            setSaved(false);
          }}
          className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-foreground outline-none focus:border-accent"
        >
          <option value={0}>—</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}/10
            </option>
          ))}
        </select>
      </label>

      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        rows={3}
        placeholder="Tu opinión sobre esta serie (la verán otros usuarios)…"
        className="mt-3 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Guardando…" : "Guardar"}
        </button>
        {saved && <span className="text-sm text-emerald-400">Guardado ✓</span>}
      </div>
    </div>
  );
}
