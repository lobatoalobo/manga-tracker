"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateEditionAction,
  deleteEditionAction,
  setCrumbQueryAction,
  updateWorkAction,
  enrichWorkFromWhakoomAction,
} from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";
import ReleaseDatePicker from "@/components/ReleaseDatePicker";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Editor admin completo para una obra del catálogo local sin AniList (/nacional).
 * Edita los campos de display del Work (título, autor, sinopsis, portada) y los
 * de la edición (tomos, URL, Crumb), o borra la entrada. Sin pasar por AniList.
 */
export default function AdminNacionalEdit({
  editionId,
  workId,
  pseudoId,
  title,
  author,
  synopsis,
  coverImage,
  genres,
  upcoming,
  releaseLabel,
  volumes,
  url,
  crumbInitial,
}: {
  editionId: number;
  workId: number | null;
  pseudoId: number;
  title: string;
  author: string;
  synopsis: string;
  coverImage: string;
  genres: string[];
  upcoming: boolean;
  releaseLabel: string;
  volumes: number;
  url: string;
  crumbInitial: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [au, setAu] = useState(author);
  const [syn, setSyn] = useState(synopsis);
  const [cov, setCov] = useState(coverImage);
  const [gen, setGen] = useState(genres.join(", "));
  const [up, setUp] = useState(upcoming);
  const [rel, setRel] = useState(releaseLabel);
  const [v, setV] = useState(String(volumes));
  const [u, setU] = useState(url);
  const [crumb, setCrumb] = useState(crumbInitial);
  const [wkUrl, setWkUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pullFromWhakoom = () =>
    start(async () => {
      if (!workId) return;
      const res = await enrichWorkFromWhakoomAction(workId, wkUrl);
      if (!res.ok) {
        setMsg(res.error);
      } else if (res.applied.length === 0) {
        setMsg("No había datos nuevos para traer.");
      } else {
        setMsg(`Traído: ${res.applied.join(", ")}`);
        setWkUrl("");
        router.refresh();
      }
      setTimeout(() => setMsg(null), 3500);
    });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 block text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        ⚙️ Editar (admin)
      </button>
    );
  }

  const saveAll = () =>
    start(async () => {
      if (workId)
        await updateWorkAction(workId, {
          title: t.trim() || title,
          author: au,
          synopsis: syn,
          coverImage: cov,
          genres: gen.split(",").map((g) => g.trim()).filter(Boolean),
          upcoming: up,
          releaseLabel: rel,
        });
      await updateEditionAction(editionId, {
        title: t.trim() || title,
        volumes: Number(v) || 0,
        url: u.trim(),
      });
      await setCrumbQueryAction(pseudoId, crumb);
      setMsg("Guardado");
      router.refresh();
      setTimeout(() => setMsg(null), 2500);
    });

  return (
    <div className="mt-3 w-full max-w-md rounded-xl border border-amber-500/30 bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">
          Editar (admin)
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-foreground"
        >
          Cerrar
        </button>
      </div>

      <div className="grid gap-2">
        <label className="text-xs text-muted">
          Título
          <input value={t} onChange={(e) => setT(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="text-xs text-muted">
          Autor
          <input value={au} onChange={(e) => setAu(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="text-xs text-muted">
          Sinopsis
          <textarea
            value={syn}
            onChange={(e) => setSyn(e.target.value)}
            rows={4}
            className={`mt-1 ${input} resize-y`}
          />
        </label>
        <label className="text-xs text-muted">
          Portada (URL de imagen)
          <input value={cov} onChange={(e) => setCov(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="text-xs text-muted">
          Géneros (separados por coma)
          <input
            value={gen}
            onChange={(e) => setGen(e.target.value)}
            placeholder="Acción, Comedia, Drama"
            className={`mt-1 ${input}`}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={up}
            onChange={(e) => setUp(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Próximo a salir (preventa / anunciada en AR)
        </label>
        {up && (
          <div className="text-xs text-muted">
            Fecha estimada de salida (opcional)
            <ReleaseDatePicker value={rel} onChange={setRel} />
          </div>
        )}
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-muted">
            Tomos
            <input
              value={v}
              onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className={`mt-1 ${input}`}
            />
          </label>
        </div>
        <div>
          <label className="text-xs text-muted">
            URL de la ficha (de la editorial)
            <input value={u} onChange={(e) => setU(e.target.value)} className={`mt-1 ${input}`} />
          </label>
          {u.trim() && (
            <a
              href={u.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-accent hover:underline"
            >
              Probar link ↗
            </a>
          )}
        </div>
        <div>
          <label className="text-xs text-muted">
            Búsqueda en Crumb
            <input value={crumb} onChange={(e) => setCrumb(e.target.value)} className={`mt-1 ${input}`} />
          </label>
          <a
            href={crumbSearch(crumb || " ")}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs text-accent hover:underline"
          >
            Probar búsqueda ↗
          </a>
        </div>
        {workId && (
          <div className="rounded-lg border border-border bg-surface-2 p-2">
            <label className="text-xs text-muted">
              Traer datos de Whakoom (admin) — pegá la URL de la edición
              <input
                value={wkUrl}
                onChange={(e) => setWkUrl(e.target.value)}
                placeholder="https://www.whakoom.com/ediciones/…"
                className={`mt-1 ${input}`}
              />
            </label>
            <button
              onClick={pullFromWhakoom}
              disabled={pending || !wkUrl.trim()}
              className="mt-2 rounded-lg border border-accent px-2.5 py-1 text-xs text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
            >
              Traer autor/sinopsis/portada
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={saveAll}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Guardar todo
        </button>
        <button
          onClick={() => {
            if (!window.confirm("¿Borrar esta entrada del catálogo?")) return;
            start(async () => {
              await deleteEditionAction(editionId);
              router.push("/");
            });
          }}
          disabled={pending}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
        >
          Borrar
        </button>
        {msg && <span className="text-xs text-emerald-400">✓ {msg}</span>}
      </div>
      {!workId && (
        <p className="mt-2 text-xs text-amber-400">
          Sin obra asociada: autor/sinopsis/portada no se guardan (solo tomos/URL).
        </p>
      )}
    </div>
  );
}
