"use client";

import { useState, useTransition } from "react";
import { setCrumbQueryAction, setOvniUrlAction } from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Panel inline (solo admin) para tunear los links de tienda de la serie:
 * el término de búsqueda de Crumb y, si hay edición de Ovni, su link a
 * OvniPress. Con preview en vivo.
 */
export default function AdminStoreLinks({
  anilistId,
  crumbInitial,
  ovni,
}: {
  anilistId: number;
  crumbInitial: string;
  ovni: { id: number; url: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [crumb, setCrumb] = useState(crumbInitial);
  const [ovniUrl, setOvniUrl] = useState(ovni?.url ?? "");
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

      {/* Ovni */}
      {ovni && (
        <>
          <label className="mt-4 block text-xs text-muted">
            Link a OvniPress
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={ovniUrl}
              onChange={(e) => setOvniUrl(e.target.value)}
              placeholder="https://www.ovnipress.net/…"
              className={input}
            />
            <button
              onClick={() =>
                save(
                  () => setOvniUrlAction(anilistId, ovni.id, ovniUrl),
                  "Ovni guardado",
                )
              }
              disabled={pending}
              className="shrink-0 rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
          {ovniUrl && (
            <a
              href={ovniUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-accent hover:underline"
            >
              Probar link ↗
            </a>
          )}
        </>
      )}

      {savedMsg && (
        <p className="mt-3 text-xs text-emerald-400">✓ {savedMsg}</p>
      )}
    </div>
  );
}
