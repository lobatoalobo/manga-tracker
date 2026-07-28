"use client";

/** Botón de cancelación de reserva del CLIENTE (Slice 3). Confirma, evita doble submit y refresca. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retailErrorLabel } from "@/lib/retail/format";
import { cancelMyOrderAction } from "./actions";

export default function CancelOrderButton({ publicCode }: { publicCode: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onCancel = () => {
    if (pending) return;
    if (!window.confirm("¿Cancelar esta reserva? No se puede deshacer.")) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelMyOrderAction(publicCode);
      if (res.ok) router.refresh();
      else setError(retailErrorLabel(res.error));
    });
  };

  return (
    <div className="mt-4">
      <button type="button" onClick={onCancel} disabled={pending} className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50">
        {pending ? "Cancelando…" : "Cancelar reserva"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
