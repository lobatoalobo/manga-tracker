"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setCrumbQueryAction,
  setEditionUrlAction,
  addSeriesEditionAction,
} from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

const PUBLISHERS = ["Ivrea Argentina", "Panini Argentina", "Ovni Press"];

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
  seriesTitle,
  crumbInitial,
  editions,
  defaultVolumes = 0,
}: {
  anilistId: number;
  seriesTitle: string;
  crumbInitial: string;
  editions: EditionLinkRow[];
  defaultVolumes?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [crumb, setCrumb] = useState(crumbInitial);
  const [urls, setUrls] = useState<Record<number, string>>(
    Object.fromEntries(editions.map((e) => [e.id, e.url])),
  );
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Form para agregar una edición que el catálogo no trajo.
  const [addPub, setAddPub] = useState(PUBLISHERS[0]);
  const [addTitle, setAddTitle] = useState(seriesTitle);
  const [addUrl, setAddUrl] = useState("");
  const [addVol, setAddVol] = useState(defaultVolumes ? String(defaultVolumes) : "");

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

      {/* Agregar una edición que el catálogo no trajo (mapea directo a la serie). */}
      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-1 text-xs text-muted">
          Agregar edición {editions.length === 0 ? "(no hay ninguna mapeada)" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            value={addPub}
            onChange={(e) => setAddPub(e.target.value)}
            className={`${input} w-auto`}
          >
            {PUBLISHERS.map((p) => (
              <option key={p} value={p}>
                {p.replace(" Argentina", "")}
              </option>
            ))}
          </select>
          <input
            value={addVol}
            onChange={(e) => setAddVol(e.target.value)}
            type="number"
            min={0}
            placeholder="Tomos"
            className={`${input} w-20`}
          />
          <input
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="Título (ej. Battle Royale Deluxe)"
            className={`${input} min-w-40 flex-1`}
          />
          <input
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="URL de la editorial"
            className={`${input} min-w-40 flex-1`}
          />
          <button
            onClick={() =>
              start(async () => {
                const r = await addSeriesEditionAction(
                  anilistId,
                  addTitle.trim() || seriesTitle,
                  addPub,
                  addUrl,
                  Number(addVol),
                );
                if (r.ok) {
                  setSavedMsg(`${addPub} agregada`);
                  setAddUrl("");
                  router.refresh();
                } else {
                  setSavedMsg(r.error ?? "Error");
                }
              })
            }
            disabled={pending}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>

      {savedMsg && <p className="mt-3 text-xs text-emerald-400">✓ {savedMsg}</p>}
    </div>
  );
}
