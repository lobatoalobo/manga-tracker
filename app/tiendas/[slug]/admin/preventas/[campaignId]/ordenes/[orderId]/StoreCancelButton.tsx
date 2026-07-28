"use client";

/** Botón de cancelación de una orden por la TIENDA (Slice 3). Razón opcional; evita doble submit. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retailErrorLabel } from "@/lib/retail/format";
import { cancelStoreOrderAction } from "../actions";

export default function StoreCancelButton({ slug, campaignId, orderId }: { slug: string; campaignId: number; orderId: number }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onCancel = () => {
    if (pending) return;
    if (!window.confirm("¿Cancelar esta orden del cliente?")) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelStoreOrderAction(slug, campaignId, orderId, reason.trim() || null);
      if (res.ok) router.refresh();
      else setError(retailErrorLabel(res.error));
    });
  };

  return (
    <div className="mt-6 rounded-xl border border-border p-4">
      <label className="block text-sm font-medium">Cancelar orden</label>
      <input
        type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280}
        placeholder="Motivo (opcional)" className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm" disabled={pending}
      />
      <button type="button" onClick={onCancel} disabled={pending} className="mt-3 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50">
        {pending ? "Cancelando…" : "Cancelar orden"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
