"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setCrumbQueryAction,
  addSeriesEditionAction,
  unlinkEditionAction,
  relinkEditionAction,
  updateSeriesEditionAction,
  deleteSeriesEditionAction,
  setWorkUpcomingAction,
} from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

const PUBLISHERS = [
  "Ivrea Argentina",
  "Panini Argentina",
  "Ovni Press",
  "Kemuri Ediciones",
];

export interface EditionLinkRow {
  id: number;
  publisher: string;
  title: string;
  volumes: number;
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
  excludedPublishers = [],
  defaultVolumes = 0,
  upcoming = false,
}: {
  anilistId: number;
  seriesTitle: string;
  crumbInitial: string;
  editions: EditionLinkRow[];
  excludedPublishers?: string[];
  defaultVolumes?: number;
  upcoming?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(upcoming);
  const [crumb, setCrumb] = useState(crumbInitial);
  const [urls, setUrls] = useState<Record<number, string>>(
    Object.fromEntries(editions.map((e) => [e.id, e.url])),
  );
  const [titles, setTitles] = useState<Record<number, string>>(
    Object.fromEntries(editions.map((e) => [e.id, e.title])),
  );
  const [vols, setVols] = useState<Record<number, string>>(
    Object.fromEntries(editions.map((e) => [e.id, String(e.volumes)])),
  );
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Editoriales que tienen al menos una card (para "Desvincular editorial").
  const presentPublishers = [...new Set(editions.map((e) => e.publisher))];

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

      {/* Próximo a salir (preventa AR) */}
      <label className="mb-3 flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={up}
          onChange={(e) => {
            const value = e.target.checked;
            setUp(value);
            save(
              () =>
                setWorkUpcomingAction(anilistId, value).then(() => {
                  router.refresh();
                }),
              "Guardado",
            );
          }}
          disabled={pending}
          className="h-4 w-4 rounded border-border"
        />
        🔜 Próximo a salir (preventa / anunciada en AR)
      </label>

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

      {/* Editor de cada edición existente: título, tomos y link. */}
      {editions.map((ed) => (
        <div
          key={ed.id}
          className="mt-4 rounded-lg border border-border bg-surface-2/40 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {ed.publisher}
            </span>
            <button
              onClick={() => {
                if (
                  !window.confirm(
                    `¿Borrar esta card de ${ed.publisher}? Solo se borra esta edición; el resto y la editorial quedan intactos.`,
                  )
                )
                  return;
                save(
                  () =>
                    deleteSeriesEditionAction(anilistId, ed.id).then(() => {
                      router.refresh();
                    }),
                  `Card de ${ed.publisher} borrada`,
                );
              }}
              disabled={pending}
              className="shrink-0 text-xs text-red-400 hover:text-red-300 hover:underline disabled:opacity-50"
            >
              Borrar ✕
            </button>
          </div>
          {excludedPublishers.includes(ed.publisher) && (
            <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
              ⚠️ {ed.publisher} está desvinculada de esta serie: esta edición no
              aparece en público hasta que la re-vincules (botón abajo).
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={titles[ed.id] ?? ""}
              onChange={(e) =>
                setTitles((p) => ({ ...p, [ed.id]: e.target.value }))
              }
              placeholder="Título de la edición"
              className={`${input} min-w-40 flex-1`}
            />
            <input
              value={vols[ed.id] ?? ""}
              onChange={(e) =>
                setVols((p) => ({ ...p, [ed.id]: e.target.value }))
              }
              type="number"
              min={0}
              placeholder="Tomos"
              className={`${input} w-20`}
            />
          </div>
          <div className="mt-2 flex gap-2">
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
                  () =>
                    updateSeriesEditionAction(anilistId, ed.id, {
                      title: (titles[ed.id] ?? "").trim() || ed.title,
                      volumes: Number(vols[ed.id]),
                      url: (urls[ed.id] ?? "").trim(),
                    }).then(() => router.refresh()),
                  `${ed.publisher} actualizada`,
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

      {/* Desvincular editorial: nivel editorial, para que esta serie NO se vuelva
          a relacionar con ella en futuros updates del catálogo. */}
      {presentPublishers.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1 text-xs text-muted">
            Desvincular editorial — bloquea que esta serie se relacione con esa
            editorial (borra todas sus cards). Para errores de catálogo, no para
            sacar una card suelta.
          </p>
          <div className="flex flex-wrap gap-2">
            {presentPublishers.map((p) => (
              <button
                key={p}
                onClick={() => {
                  if (
                    !window.confirm(
                      `¿Desvincular ${p} de esta serie? Se borran TODAS sus cards y no se volverá a relacionar (podés deshacerlo con "Re-vincular").`,
                    )
                  )
                    return;
                  save(
                    () =>
                      unlinkEditionAction(anilistId, p).then(() => {
                        router.refresh();
                      }),
                    `${p} desvinculada`,
                  );
                }}
                disabled={pending}
                className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-50"
              >
                ⛔ Desvincular {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Editoriales desvinculadas: re-vincular (vuelve a permitir el matcheo). */}
      {excludedPublishers.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs text-muted">Desvinculadas de esta serie</p>
          <div className="flex flex-wrap gap-2">
            {excludedPublishers.map((p) => (
              <button
                key={p}
                onClick={() =>
                  save(
                    () =>
                      relinkEditionAction(anilistId, p).then(() => {
                        router.refresh();
                      }),
                    `${p} re-vinculada`,
                  )
                }
                disabled={pending}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                ↩ Re-vincular {p}
              </button>
            ))}
          </div>
        </div>
      )}

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
