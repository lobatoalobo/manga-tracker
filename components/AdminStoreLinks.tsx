"use client";

import { useState, useTransition } from "react";
import { setCrumbQueryAction, setEditionUrlAction } from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

export interface EditionLinkRow {
  id: number;
  publisher: string;
  url: string;
}

/**
 * Panel inline (solo admin) para tunear los links de tienda de la serie: el
 * término de búsqueda de Crumb y la URL de cada edición (cualquier editorial),
 * por si alguna se rompe. Con preview en vivo.
 */
export default function AdminStoreLinks({
  anilistId,
  crumbInitial,
  editions,
}: {
  anilistId: number;
  crumbInitial: string;
  editions: EditionLinkRow[];
}) {
  const [open, setOpen] = useState(false);
  const [crumb, setCrumb] = useState(crumbInitial);
  const [urls, setUrls] = useState<Record<number, string>>(
    Object.fromEntries(editions.map((e) => [e.id, e.url])),
  );
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (fn: () => Promise<void>, msg: string) =>
    start(async () => {
      await fn();
      setSavedMsg(msg);
      setTimeout(() => setSavedMsg(null), 2000);
    });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        ⚙️ Links de tienda (admin)
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-amber-500/30 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">
          Links de tienda (admin)
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-foreground"
        >
          Cerrar
        </button>
      </div>

      {/* Crumb */}
      <label className="text-xs text-muted">Búsqueda en Crumb</label>
      <div className="mt-1 flex gap-2">
        <input
          value={crumb}
          onChange={(e) => setCrumb(e.target.value)}
          placeholder="Término de búsqueda…"
          className={input}
        />
        <button
          onClick={() =>
            save(() => setCrumbQueryAction(anilistId, crumb), "Crumb guardado")
          }
          disabled={pending}
          className="shrink-0 rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
        >
          Guardar
        </button>
      </div>
      <a
        href={crumbSearch(crumb || " ")}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-xs text-accent hover:underline"
      >
        Probar búsqueda ↗
      </a>

      {/* Links de cada edición */}
      {editions.map((ed) => (
        <div key={ed.id} className="mt-4">
          <label className="block text-xs text-muted">
            Link · {ed.publisher}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={urls[ed.id] ?? ""}
              onChange={(e) =>
                setUrls((p) => ({ ...p, [ed.id]: e.target.value }))
              }
              placeholder="https://…"
              className={input}
            />
            <button
              onClick={() =>
                save(
                  () => setEditionUrlAction(anilistId, ed.id, urls[ed.id] ?? ""),
                  `${ed.publisher} guardado`,
                )
              }
              disabled={pending}
              className="shrink-0 rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
          {urls[ed.id] && (
            <a
              href={urls[ed.id]}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-accent hover:underline"
            >
              Probar link ↗
            </a>
          )}
        </div>
      ))}

      {savedMsg && <p className="mt-3 text-xs text-emerald-400">✓ {savedMsg}</p>}
    </div>
  );
}
