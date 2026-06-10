"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { importCollectionAction } from "@/app/actions";

export default function ImportExport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(importCollectionAction, null);

  // Refrescar la grilla al importar OK.
  if (state?.ok && state.imported > 0) router.refresh();

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        <a
          href="/api/export"
          className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
        >
          ⬇ Exportar CSV
        </a>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
        >
          ⬆ Importar CSV
        </button>
      </div>

      {open && (
        <form
          action={action}
          className="mt-3 rounded-xl border border-border bg-surface p-4"
        >
          <p className="mb-2 text-sm text-muted">
            Subí un CSV (el mismo formato del export). Columnas mínimas:{" "}
            <code>title</code>, <code>edition</code>, <code>totalVolumes</code>,{" "}
            <code>owned</code> (tomos separados por espacio). Si no hay{" "}
            <code>anilistId</code>, se resuelve por título.
          </p>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
          />
          <button
            disabled={pending}
            className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Importando…" : "Importar"}
          </button>

          {state && !state.ok && (
            <p className="mt-2 text-sm text-red-400">{state.error}</p>
          )}
          {state?.ok && (
            <div className="mt-2 text-sm">
              <p className="text-emerald-400">
                Importadas {state.imported} ediciones.
              </p>
              {state.errors.length > 0 && (
                <ul className="mt-1 text-xs text-muted">
                  {state.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
