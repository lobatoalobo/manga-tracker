"use client";

/**
 * Panel "Avisos al cliente" (Slice 5, §19/§20). Flujo: Preparar aviso → revisar/editar mensaje → Copiar →
 * Marcar como enviado. "Copiar" es SOLO UI (no registra envío). "Marcar como enviado" usa una `sendOperationKey`
 * estable por intento (idempotencia: se reutiliza en reintentos, se rota tras un resultado definitivo).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retailErrorLabel, notificationStatusLabel } from "@/lib/retail/format";
import { createArrivalDraftAction, updateArrivalDraftAction, cancelArrivalDraftAction, markArrivalSentAction } from "./notifActions";

interface PreviewLine { orderLineId: number; title: string; volumeNumber: number | null; arrivedQuantity: number; notifiedQuantity: number; pendingUnnotified: number }
interface NotifItem { quantity: number; orderLine: { titleSnapshot: string; volumeNumberSnapshot: number | null } }
interface Notif { id: number; status: string; messageSnapshot: string; createdAt: string; sentAt: string | null; cancelledAt: string | null; items: NotifItem[] }

export default function ArrivalNotifications({ slug, campaignId, orderId, preview, notifications }: {
  slug: string; campaignId: number; orderId: number;
  preview: { lines: PreviewLine[]; suggestedMessage: string; hasPending: boolean };
  notifications: Notif[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pendingLines = preview.lines.filter((l) => l.pendingUnnotified > 0);
  const [qty, setQty] = useState<Record<number, number>>(() => Object.fromEntries(pendingLines.map((l) => [l.orderLineId, l.pendingUnnotified])));
  const sendKeyRef = useRef<Record<number, string>>({});

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, opts?: { keyId?: number }) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (opts?.keyId != null) delete sendKeyRef.current[opts.keyId]; // resultado definitivo → rotar clave
        if (res.ok) router.refresh();
        else setError(retailErrorLabel(res.error));
      } catch {
        setError("No pudimos confirmar la operación. Reintentá.");
      }
    });
  };

  const createDraft = () => {
    const items = pendingLines.map((l) => ({ orderLineId: l.orderLineId, quantity: Math.max(0, Math.min(l.pendingUnnotified, qty[l.orderLineId] ?? 0)) })).filter((i) => i.quantity > 0);
    if (items.length === 0) { setError("Elegí al menos una unidad."); return; }
    run(() => createArrivalDraftAction(slug, campaignId, orderId, items));
  };
  const markSent = (id: number) => {
    const key = sendKeyRef.current[id] ?? crypto.randomUUID();
    sendKeyRef.current[id] = key;
    run(() => markArrivalSentAction(slug, campaignId, orderId, id, key), { keyId: id });
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("es-AR") : "—");

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Avisos al cliente</h2>

      {preview.hasPending ? (
        <div className="mt-3 rounded-xl border border-border p-4">
          <p className="text-sm font-medium">Preparar aviso de llegada</p>
          <ul className="mt-2 space-y-1 text-sm">
            {pendingLines.map((l) => (
              <li key={l.orderLineId} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{l.title} {l.volumeNumber != null && <span>#{l.volumeNumber}</span>} <span className="text-muted">· {l.pendingUnnotified} sin informar</span></span>
                <input type="number" min={0} max={l.pendingUnnotified} value={qty[l.orderLineId] ?? 0} disabled={pending}
                  onChange={(e) => setQty((p) => ({ ...p, [l.orderLineId]: Math.max(0, Math.min(l.pendingUnnotified, Math.floor(Number(e.target.value) || 0))) }))}
                  className="h-8 w-16 rounded-md border border-border text-center" />
              </li>
            ))}
          </ul>
          <button type="button" onClick={createDraft} disabled={pending} className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Preparar aviso</button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">No hay unidades llegadas pendientes de informar.</p>
      )}

      <ul className="mt-4 space-y-3">
        {notifications.map((n) => (
          <NotificationCard key={n.id} n={n} slug={slug} campaignId={campaignId} orderId={orderId} pending={pending} fmt={fmt}
            onSend={() => markSent(n.id)} onCancel={() => run(() => cancelArrivalDraftAction(slug, campaignId, orderId, n.id))}
            onSave={(msg) => run(() => updateArrivalDraftAction(slug, campaignId, orderId, n.id, msg))} />
        ))}
        {notifications.length === 0 && <li className="text-sm text-muted">Sin avisos todavía.</li>}
      </ul>

      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function NotificationCard({ n, pending, fmt, onSend, onCancel, onSave }: {
  n: Notif; slug: string; campaignId: number; orderId: number; pending: boolean; fmt: (d: string | null) => string;
  onSend: () => void; onCancel: () => void; onSave: (msg: string) => void;
}) {
  const [msg, setMsg] = useState(n.messageSnapshot);
  const [copied, setCopied] = useState(false);
  const isDraft = n.status === "DRAFT";

  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* clipboard no disponible */ } };

  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{notificationStatusLabel(n.status)}</span>
        <span className="text-xs text-muted">{n.status === "SENT" ? `Enviado ${fmt(n.sentAt)}` : n.status === "CANCELLED" ? `Cancelado ${fmt(n.cancelledAt)}` : `Borrador ${fmt(n.createdAt)}`}</span>
      </div>
      <p className="mt-2 text-xs text-muted">{n.items.map((i) => `${i.orderLine.titleSnapshot}${i.orderLine.volumeNumberSnapshot != null ? ` #${i.orderLine.volumeNumberSnapshot}` : ""} ×${i.quantity}`).join(" · ")}</p>

      {isDraft ? (
        <>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={6} maxLength={2000} disabled={pending} className="mt-2 w-full rounded-md border border-border p-2 text-sm" />
          <p className="mt-1 text-xs text-muted">Copiar el mensaje no registra el envío.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="rounded-md border border-border px-3 py-1 text-sm">{copied ? "Copiado ✓" : "Copiar mensaje"}</button>
            <button type="button" onClick={() => onSave(msg)} disabled={pending || msg === n.messageSnapshot} className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-40">Guardar</button>
            <button type="button" onClick={onSend} disabled={pending} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50">Marcar como enviado</button>
            <button type="button" onClick={onCancel} disabled={pending} className="rounded-md border border-red-500/40 px-3 py-1 text-sm text-red-600 disabled:opacity-40">Cancelar borrador</button>
          </div>
        </>
      ) : (
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface p-2 text-xs">{n.messageSnapshot}</pre>
      )}
    </li>
  );
}
