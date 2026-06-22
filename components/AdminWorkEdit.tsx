"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWorkAction, setCrumbQueryAction, uploadCoverAction } from "@/app/actions";
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
      setMsg("Imagen subida a R2");
    } else {
      setMsg(r.error);
    }
    setTimeout(() => setMsg(null), 3000);
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

  const save = () =>
    start(async () => {
      await updateWorkAction(workId, {
        title: t.trim() || title,
        author: au,
        synopsis: syn,
        coverImage: cov,
        genres: gen.split(",").map((g) => g.trim()).filter(Boolean),
        upcoming: up,
        releaseLabel: rel,
      });
      await setCrumbQueryAction(pseudoId, crumb);
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
      </div>
    </div>
  );
}
