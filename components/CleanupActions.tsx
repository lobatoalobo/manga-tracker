"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEditionAction, markWorkUpcomingAction } from "@/app/actions";

/**
 * Acciones de limpieza por edición (en /admin/herramientas): "Marcar próxima"
 * (debut válido sin tomos → sale de la lista) y "Borrar" (basura/redundante).
 * Tras cada acción refrescamos el RSC para que la lista se reacomode sola (el
 * ítem actuado desaparece) sin tener que recargar a mano.
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
  const router = useRouter();

  return (
    <span className="flex shrink-0 gap-1.5">
      {workId != null && (
        <button
          type="button"
          onClick={() =>
            start(async () => {
              await markWorkUpcomingAction(workId);
              router.refresh();
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
            router.refresh();
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
