"use client";

/**
 * Controles de preparación y retiro (Slice 7). Continúa el ciclo físico outbound por línea. Cada operación
 * indica claramente la cantidad. Idempotencia: clave estable por intento en un `ref` (se reutiliza en
 * reintentos, se rota tras un resultado definitivo). Las masivas construyen un payload EXPLÍCITO e inmutable
 * (`items`) UNA sola vez desde el snapshot visible; el servidor nunca recalcula el alcance en un retry.
 *
 * La UI nunca muestra "entregado" salvo `ORDER_HANDOFF == COMPLETED` (eso lo decide la página, no este panel).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retailErrorLabel } from "@/lib/retail/format";
import { prepareLineAction, pickupLineAction, prepareBatchAction, pickupBatchAction } from "./handoffActions";

export interface HandoffLine {
  id: number;
  title: string;
  volumeNumber: number | null;
  quantity: number;
  arrivedQuantity: number;
  preparedQuantity: number;
  pickedUpQuantity: number;
  preparableQuantity: number;
  pickupableQuantity: number;
}

type LineOp = "prepare" | "pickup";
type BatchOp = "prepareAll" | "pickupAll";

export default function HandoffControls({ slug, campaignId, orderId, lines }: { slug: string; campaignId: number; orderId: number; lines: HandoffLine[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lineKeyRef = useRef<Record<string, string>>({}); // clave por (op:lineId)
  const batchKeyRef = useRef<Partial<Record<BatchOp, string>>>({});

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onDefinitive: () => void) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        onDefinitive(); // resultado definitivo → rotar clave
        if (res.ok) router.refresh();
        else setError(retailErrorLabel(res.error));
      } catch {
        setError("No pudimos confirmar la operación. Reintentá."); // incierto → conservar la clave
      }
    });
  };

  const runLine = (op: LineOp, lineId: number, qty: number) => {
    if (qty < 1) return;
    const refKey = `${op}:${lineId}`;
    const key = lineKeyRef.current[refKey] ?? crypto.randomUUID();
    lineKeyRef.current[refKey] = key;
    const call = op === "prepare"
      ? () => prepareLineAction(slug, campaignId, orderId, lineId, qty, key)
      : () => pickupLineAction(slug, campaignId, orderId, lineId, qty, key);
    run(call, () => { delete lineKeyRef.current[refKey]; });
  };

  const runBatch = (op: BatchOp) => {
    // Payload EXPLÍCITO construido UNA vez desde el snapshot visible (deltas actuales).
    const items = op === "prepareAll"
      ? lines.filter((l) => l.preparableQuantity > 0).map((l) => ({ orderLineId: l.id, quantity: l.preparableQuantity }))
      : lines.filter((l) => l.pickupableQuantity > 0).map((l) => ({ orderLineId: l.id, quantity: l.pickupableQuantity }));
    if (items.length === 0) { setError(op === "prepareAll" ? "No hay unidades para preparar." : "No hay unidades para retirar."); return; }
    const key = batchKeyRef.current[op] ?? crypto.randomUUID();
    batchKeyRef.current[op] = key;
    const call = op === "prepareAll"
      ? () => prepareBatchAction(slug, campaignId, orderId, items, key)
      : () => pickupBatchAction(slug, campaignId, orderId, items, key);
    run(call, () => { delete batchKeyRef.current[op]; });
  };

  const anyPreparable = lines.some((l) => l.preparableQuantity > 0);
  const anyPickupable = lines.some((l) => l.pickupableQuantity > 0);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Preparación y retiro</h2>

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => runBatch("prepareAll")} disabled={pending || !anyPreparable} className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40">Preparar todo lo llegado</button>
        <button type="button" onClick={() => runBatch("pickupAll")} disabled={pending || !anyPickupable} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Registrar retiro de todo lo preparado</button>
      </div>

      <ul className="mt-3 space-y-3">
        {lines.map((l) => (
          <LineRow key={l.id} line={l} pending={pending} onPrepare={(q) => runLine("prepare", l.id, q)} onPickup={(q) => runLine("pickup", l.id, q)} />
        ))}
      </ul>

      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function LineRow({ line, pending, onPrepare, onPickup }: { line: HandoffLine; pending: boolean; onPrepare: (q: number) => void; onPickup: (q: number) => void }) {
  const [prepQty, setPrepQty] = useState(1);
  const [pickQty, setPickQty] = useState(1);
  const clamp = (v: number, max: number) => Math.max(1, Math.min(max || 1, Math.floor(v || 1)));

  return (
    <li className="rounded-xl border border-border p-4 text-sm">
      <span className="font-medium">{line.title} {line.volumeNumber != null && <span>#{line.volumeNumber}</span>}</span>
      <p className="mt-1 text-xs text-muted">
        Llegó {line.arrivedQuantity} · Preparado {line.preparedQuantity} · Retirado {line.pickedUpQuantity}
        {line.pickupableQuantity > 0 && <span className="font-medium text-green-700"> · {line.pickupableQuantity} listo para retirar</span>}
      </p>
      <div className="mt-2 flex flex-wrap gap-4">
        {line.preparableQuantity > 0 && (
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={line.preparableQuantity} value={prepQty} disabled={pending}
              onChange={(e) => setPrepQty(clamp(Number(e.target.value), line.preparableQuantity))} className="h-8 w-16 rounded-md border border-border text-center" />
            <button type="button" disabled={pending} onClick={() => onPrepare(prepQty)} className="rounded-md border border-border px-3 py-1 disabled:opacity-40">Preparar</button>
          </div>
        )}
        {line.pickupableQuantity > 0 && (
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={line.pickupableQuantity} value={pickQty} disabled={pending}
              onChange={(e) => setPickQty(clamp(Number(e.target.value), line.pickupableQuantity))} className="h-8 w-16 rounded-md border border-border text-center" />
            <button type="button" disabled={pending} onClick={() => onPickup(pickQty)} className="rounded-md border border-green-600/40 px-3 py-1 text-green-700 disabled:opacity-40">Registrar retiro</button>
          </div>
        )}
        {line.preparableQuantity === 0 && line.pickupableQuantity === 0 && (
          <span className="text-xs text-muted">Sin unidades para preparar o retirar.</span>
        )}
      </div>
    </li>
  );
}
