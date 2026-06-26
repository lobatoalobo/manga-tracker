"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateWorkAction,
  setCrumbQueryAction,
  uploadCoverAction,
  deleteWorkAction,
  setEditionVolumesAction,
} from "@/app/actions";
import { crumbSearch } from "@/lib/crumb";
import ReleaseDatePicker from "@/components/ReleaseDatePicker";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Editor admin de los campos de display de un `Work` del catálogo local
 * (título, autor, sinopsis, portada, géneros, próximo a salir + fecha). Para
 * curar datos sin pasar por AniList. Usa updateWorkAction.
 */
export default function AdminWorkEdit({
  workId,
  pseudoId,
  title,
  author,
  synopsis,
  coverImage,
  genres,
  upcoming,
  releaseLabel,
  crumbInitial,
  editions,
}: {
  workId: number;
  pseudoId: number;
  title: string;
  author: string;
  synopsis: string;
  coverImage: string;
  genres: string[];
  upcoming: boolean;
  releaseLabel: string;
  crumbInitial: string;
  editions: { id: number; label: string; volumes: number }[];
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
  const [crumb, setCrumb] = useState(crumbInitial);
  const [msg, setMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadCoverAction(fd);
    setUploading(false);
    e.target.value = "";
    if (r.ok) {
      setCov(r.url);
      setErrMsg(null);
      setMsg("Imagen subida a R2");
      setTimeout(() => setMsg(null), 3000);
    } else {
      setMsg(null);
      setErrMsg(r.error);
      setTimeout(() => setErrMsg(null), 6000);
    }
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 block text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        ⚙️ Editar (admin)
      </button>
    );

  const remove = () => {
    if (
      !confirm(
        `¿BORRAR la entrada "${title}" del catálogo? Se eliminan sus ediciones y la colección/deseados que tengan los usuarios sobre esta serie. No se puede deshacer.\n\nUsalo solo para duplicados/basura. Si es una serie real con colección, conviene fusionarla, no borrarla.`,
      )
    )
      return;
    start(async () => {
      const r = await deleteWorkAction(workId);
      if (r.ok) {
        const extra =
          r.collectionRemoved || r.wishlistRemoved
            ? ` (también ${r.collectionRemoved} de colección y ${r.wishlistRemoved} de deseados)`
            : "";
        alert(`Entrada borrada: ${r.editionsDeleted} ediciones${extra}.`);
        router.push("/catalogo");
      }
    });
  };

  const save = () =>
    start(async () => {
      // Mandamos SOLO los campos que cambiaron respecto a lo cargado. Así editar
      // la portada no reescribe (ni borra) el autor — era el bug de 300/Frank
      // Miller. Si querés vaciar un campo a propósito, ese cambio sí se manda.
      const data: {
        title?: string;
        author?: string;
        synopsis?: string;
        coverImage?: string;
        genres?: string[];
        upcoming?: boolean;
        releaseLabel?: string;
      } = {};
      const newTitle = t.trim() || title;
      if (newTitle !== title) data.title = newTitle;
      if (au !== author) data.author = au;
      if (syn !== synopsis) data.synopsis = syn;
      if (cov !== coverImage) data.coverImage = cov;
      const newGenres = gen.split(",").map((g) => g.trim()).filter(Boolean);
      if (newGenres.join("|") !== genres.join("|")) data.genres = newGenres;
      if (up !== upcoming) data.upcoming = up;
      if (rel !== releaseLabel) data.releaseLabel = rel;

      if (Object.keys(data).length) await updateWorkAction(workId, data);
      if (crumb !== crumbInitial) await setCrumbQueryAction(pseudoId, crumb);
      setMsg("Guardado");
      router.refresh();
      setTimeout(() => setMsg(null), 2500);
    });

  return (
    <div className="mt-4 w-full max-w-md rounded-xl border border-amber-500/30 bg-surface p-4">
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
          Portada — pegá una URL o subí un archivo (se guarda en R2, propia)
          <input value={cov} onChange={(e) => setCov(e.target.value)} className={`mt-1 ${input}`} />
          <div className="mt-1 flex items-center gap-2">
            <label
              className={`cursor-pointer rounded-lg border border-border px-2 py-1 text-xs transition hover:border-accent ${uploading ? "opacity-50" : ""}`}
            >
              {uploading ? "Subiendo…" : "📤 Subir archivo"}
              <input
                type="file"
                accept="image/*"
                onChange={onFile}
                disabled={uploading}
                className="hidden"
              />
            </label>
            {cov && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cov} alt="" className="h-10 w-7 rounded object-cover" />
            )}
          </div>
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
        {editions.length > 0 && (
          <div className="rounded-lg border border-border p-2">
            <p className="mb-1 text-xs font-medium text-muted">Tomos por edición</p>
            <div className="grid gap-1.5">
              {editions.map((e) => (
                <EditionVolumes key={e.id} edition={e} onSaved={() => router.refresh()} />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              El conteo que fijes acá queda bloqueado: el crawl no lo pisa.
            </p>
          </div>
        )}
        <div>
          <label className="text-xs text-muted">
            Búsqueda en Crumb (lo que se usa en el botón "Comprar")
            <input
              value={crumb}
              onChange={(e) => setCrumb(e.target.value)}
              className={`mt-1 ${input}`}
            />
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
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Guardar
        </button>
        {msg && <span className="text-xs text-emerald-400">✓ {msg}</span>}
        {errMsg && <span className="text-xs text-rose-400">✗ {errMsg}</span>}
      </div>

      <div className="mt-4 border-t border-rose-500/20 pt-3">
        <button
          onClick={remove}
          disabled={pending}
          className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50"
        >
          Borrar entrada
        </button>
        <p className="mt-1.5 text-xs text-muted">
          Elimina esta serie y sus ediciones. Para duplicados que no aparecen en
          “Series duplicadas”.
        </p>
      </div>
    </div>
  );
}

/** Fila para fijar a mano el conteo de tomos de una edición (admin). */
function EditionVolumes({
  edition,
  onSaved,
}: {
  edition: { id: number; label: string; volumes: number };
  onSaved: () => void;
}) {
  const [v, setV] = useState(String(edition.volumes));
  const [saving, start] = useTransition();
  const [ok, setOk] = useState(false);
  const save = () =>
    start(async () => {
      const r = await setEditionVolumesAction(edition.id, Number(v));
      if (r.ok) {
        setOk(true);
        setTimeout(() => setOk(false), 2000);
        onSaved();
      }
    });
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted">{edition.label}</span>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-center outline-none focus:border-accent"
        aria-label={`Tomos de ${edition.label}`}
      />
      <button
        onClick={save}
        disabled={saving || v === String(edition.volumes)}
        className="rounded-md border border-border px-2 py-1 transition hover:border-accent disabled:opacity-40"
      >
        {ok ? "✓" : "Fijar"}
      </button>
    </div>
  );
}
