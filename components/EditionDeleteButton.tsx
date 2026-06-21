"use client";

import { useState, useTransition } from "react";
import { deleteEditionAction } from "@/app/actions";

/** Borra una edición del catálogo (desde la integridad de /admin/herramientas). */
export default function EditionDeleteButton({
  id,
  label,
}: {
  id: number;
  label: string;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  if (done) return <span className="shrink-0 text-xs text-emerald-300">borrada ✓</span>;

  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm(`¿Borrar la edición "${label}"? No se puede deshacer.`)) return;
        start(async () => {
          await deleteEditionAction(id);
          setDone(true);
        });
      }}
      disabled={pending}
      className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-rose-400 hover:text-rose-400 disabled:opacity-50"
    >
      Borrar
    </button>
  );
}
