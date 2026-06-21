"use client";

import { useState, useTransition } from "react";
import { deleteEditionAction, markWorkUpcomingAction } from "@/app/actions";

/**
 * Acciones de limpieza por edición (en /admin/herramientas): "Marcar próxima"
 * (debut válido sin tomos → sale de la lista) y "Borrar" (basura/redundante).
 */
export default function CleanupActions({
  editionId,
  workId,
  label,
}: {
  editionId: number;
  workId?: number;
  label: string;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | "próxima" | "borrada">(null);

  if (done)
    return (
      <span className="shrink-0 text-xs text-emerald-300">
        {done === "próxima" ? "marcada próxima ✓" : "borrada ✓"}
      </span>
    );

  return (
    <span className="flex shrink-0 gap-1.5">
      {workId != null && (
        <button
          type="button"
          onClick={() =>
            start(async () => {
              await markWorkUpcomingAction(workId);
              setDone("próxima");
            })
          }
          disabled={pending}
          className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-amber-400 hover:text-amber-300 disabled:opacity-50"
        >
          Marcar próxima
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (!confirm(`¿Borrar la edición "${label}"? No se puede deshacer.`)) return;
          start(async () => {
            await deleteEditionAction(editionId);
            setDone("borrada");
          });
        }}
        disabled={pending}
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-rose-400 hover:text-rose-400 disabled:opacity-50"
      >
        Borrar
      </button>
    </span>
  );
}
