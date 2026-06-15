"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEditionAction, deleteEditionAction } from "@/app/actions";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Editor admin inline para una obra del catálogo local sin AniList (página
 * /nacional). Corrige título/tomos/URL o borra la entrada, sin pasar por
 * /admin/mapeos. Reusa las acciones existentes (por editionId).
 */
export default function AdminNacionalEdit({
  editionId,
  title,
  volumes,
  url,
}: {
  editionId: number;
  title: string;
  volumes: number;
  url: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [v, setV] = useState(String(volumes));
  const [u, setU] = useState(url);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
          Tomos
          <input
            value={v}
            onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={`mt-1 ${input}`}
          />
        </label>
        <label className="text-xs text-muted">
          URL de la ficha (de la editorial)
          <input value={u} onChange={(e) => setU(e.target.value)} className={`mt-1 ${input}`} />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() =>
            start(async () => {
              await updateEditionAction(editionId, {
                title: t.trim() || title,
                volumes: Number(v) || 0,
                url: u.trim(),
              });
              setMsg("Guardado");
              router.refresh();
              setTimeout(() => setMsg(null), 2000);
            })
          }
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Guardar
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
    </div>
  );
}
