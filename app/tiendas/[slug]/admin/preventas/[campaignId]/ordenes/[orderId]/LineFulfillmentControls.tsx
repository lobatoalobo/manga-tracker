"use client";

/**
 * Controles de cumplimiento por LÍNEA (Slice 4, §15 + endurecimiento de idempotencia). Cada operación indica
 * CLARAMENTE la cantidad afectada y opera una sola línea.
 *
 * ## Ciclo de vida de `operationKey` (idempotencia real, no basada solo en el botón)
 * Cada operación (pedido / llegada / cancelación) tiene UNA clave por intento lógico, guardada en un ref:
 *  - se genera al primer clic si no hay clave viva para esa operación;
 *  - se REUTILIZA en todo reintento (doble clic, respuesta perdida y reenvío) → el servidor la reconoce como
 *    el mismo intento y es idempotente;
 *  - se conserva mientras el resultado sea INCIERTO (throw de red/desconocido);
 *  - se ROTA sólo tras un resultado DEFINITIVO (éxito o error de dominio).
 * `useTransition` evita el doble submit VISUAL, pero la integridad la garantiza la clave estable + el servidor.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fulfillmentStatusLabel, retailErrorLabel } from "@/lib/retail/format";
import { markLineOrderedAction, markLineArrivedAction, cancelLineQuantityAction } from "../actions";

export interface LineView {
  id: number;
  title: string;
  volumeNumber: number | null;
  quantity: number;
  orderedQuantity: number;
  arrivedQuantity: number;
  cancelledQuantity: number;
  fulfillmentStatus: string;
}

type Op = "ordered" | "arrived" | "cancel";

export default function LineFulfillmentControls({ slug, campaignId, orderId, line }: { slug: string; campaignId: number; orderId: number; line: LineView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  // Clave viva por operación: persiste entre reintentos del MISMO intento lógico hasta un resultado definitivo.
  const keyRef = useRef<Partial<Record<Op, string>>>({});

  const pendingQty = line.quantity - line.arrivedQuantity - line.cancelledQuantity;
  const orderable = line.quantity - line.cancelledQuantity - line.orderedQuantity;
  const [orderQty, setOrderQty] = useState(1);
  const [arriveQty, setArriveQty] = useState(1);
  const [cancelQty, setCancelQty] = useState(1);

  const run = (op: Op, qty: number) => {
    if (pending || qty < 1) return;
    setError(null);
    // Reusar la clave viva del intento; si no hay, crear una (una sola por intento lógico).
    const operationKey = keyRef.current[op] ?? crypto.randomUUID();
    keyRef.current[op] = operationKey;
    startTransition(async () => {
      try {
        const res =
          op === "ordered" ? await markLineOrderedAction(slug, campaignId, orderId, line.id, qty, operationKey)
          : op === "arrived" ? await markLineArrivedAction(slug, campaignId, orderId, line.id, qty, operationKey)
          : await cancelLineQuantityAction(slug, campaignId, orderId, line.id, qty, reason.trim() || null, operationKey);
        // Resultado DEFINITIVO (éxito o error de dominio) → rotar la clave (el próximo clic es otro intento).
        delete keyRef.current[op];
        if (res.ok) { setReason(""); router.refresh(); }
        else setError(retailErrorLabel(res.error));
      } catch {
        // Resultado INCIERTO (red/desconocido): conservar la clave para que el reintento sea idempotente.
        setError("No pudimos confirmar la operación. Reintentá.");
      }
    });
  };

  const clamp = (v: number, max: number) => Math.max(1, Math.min(max || 1, Math.floor(v || 1)));
  const isTerminal = pendingQty <= 0;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{line.title} {line.volumeNumber != null && <span>#{line.volumeNumber}</span>}</span>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{fulfillmentStatusLabel(line.fulfillmentStatus)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Reservado {line.quantity} · Pedido {line.orderedQuantity} · Llegó {line.arrivedQuantity} · Cancelado {line.cancelledQuantity} · <span className="font-medium">Pendiente {pendingQty}</span>
      </p>

      {!isTerminal && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={Math.max(1, orderable)} value={orderQty} disabled={pending || orderable <= 0}
              onChange={(e) => setOrderQty(clamp(Number(e.target.value), orderable))} className="h-8 w-16 rounded-md border border-border text-center" />
            <button type="button" disabled={pending || orderable <= 0} onClick={() => run("ordered", orderQty)} className="rounded-md border border-border px-3 py-1 disabled:opacity-40">Marcar pedido</button>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={pendingQty} value={arriveQty} disabled={pending}
              onChange={(e) => setArriveQty(clamp(Number(e.target.value), pendingQty))} className="h-8 w-16 rounded-md border border-border text-center" />
            <button type="button" disabled={pending} onClick={() => run("arrived", arriveQty)} className="rounded-md border border-green-600/40 px-3 py-1 text-green-700 disabled:opacity-40">Registrar llegada</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" min={1} max={pendingQty} value={cancelQty} disabled={pending}
              onChange={(e) => setCancelQty(clamp(Number(e.target.value), pendingQty))} className="h-8 w-16 rounded-md border border-border text-center" />
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} placeholder="Motivo (opcional)" disabled={pending} className="h-8 flex-1 rounded-md border border-border px-2" />
            <button type="button" disabled={pending} onClick={() => run("cancel", cancelQty)} className="rounded-md border border-red-500/40 px-3 py-1 text-red-600 disabled:opacity-40">Cancelar pendiente</button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
