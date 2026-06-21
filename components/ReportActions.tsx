"use client";

import { useTransition } from "react";
import Link from "next/link";
import { resolveReportAction, deleteReportAction } from "@/app/actions";

export default function ReportActions({
  id,
  mangaId,
  status,
}: {
  id: number;
  mangaId: number | null;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();
  const resolved = status === "RESOLVED";

  return (
    <div className="flex items-center gap-3">
      {mangaId && (
        <Link
          href={`/manga/${mangaId}`}
          className="text-sm text-accent hover:underline"
        >
          Ver manga
        </Link>
      )}
      <button
        onClick={() =>
          startTransition(() =>
            resolveReportAction(id, resolved ? "PENDING" : "RESOLVED").then(
              () => {},
            ),
          )
        }
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
      >
        {resolved ? "Reabrir" : "Marcar resuelto"}
      </button>
      <button
        onClick={() => {
          if (!confirm("¿Borrar este reporte? No se puede deshacer.")) return;
          startTransition(() => deleteReportAction(id).then(() => {}));
        }}
        disabled={isPending}
        aria-label="Borrar reporte"
        className="rounded-lg border border-border px-3 py-1.5 text-sm text-rose-400 transition hover:border-rose-400 disabled:opacity-50"
      >
        Borrar
      </button>
    </div>
  );
}
