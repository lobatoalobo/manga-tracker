"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MappingRow from "@/components/MappingRow";
import { bulkEditionAction } from "@/app/actions";
import type { EditionMapping } from "@/lib/catalog";

export default function MappingList({
  rows,
  anilistVolumes,
}: {
  rows: EditionMapping[];
  anilistVolumes: Record<number, number>;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();

  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () =>
    setSel(() => (allSelected ? new Set() : new Set(rows.map((r) => r.id))));

  const bulk = (op: "delete" | "national" | "unnational") =>
    start(async () => {
      if (op === "delete" && !confirm(`¿Borrar ${sel.size} entradas del catálogo?`))
        return;
      await bulkEditionAction([...sel], op);
      setSel(new Set());
      router.refresh();
    });

  return (
    <>
      {rows.length > 0 && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 accent-rose-600"
          />
          Seleccionar la página ({rows.length})
        </label>
      )}

      <ul className="space-y-2">
        {rows.map((row) => (
          <MappingRow
            key={row.id}
            row={row}
            anilistVolumes={row.anilistId ? anilistVolumes[row.anilistId] ?? null : null}
            selected={sel.has(row.id)}
            onToggle={toggle}
          />
        ))}
      </ul>

      {sel.size > 0 && (
        <div className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">{sel.size} seleccionadas</span>
          <span className="text-muted">·</span>
          <button
            onClick={() => bulk("national")}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50"
          >
            🇦🇷 Nacional-only
          </button>
          <button
            onClick={() => bulk("unnational")}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50"
          >
            Quitar nacional
          </button>
          <button
            onClick={() => bulk("delete")}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
          >
            🗑 Borrar
          </button>
          <button
            onClick={() => setSel(new Set())}
            disabled={pending}
            className="ml-auto text-xs text-muted hover:text-foreground"
          >
            Limpiar
          </button>
        </div>
      )}
    </>
  );
}
