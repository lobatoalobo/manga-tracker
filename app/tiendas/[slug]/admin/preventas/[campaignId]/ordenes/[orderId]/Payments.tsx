"use client";

/**
 * Panel "Pagos" (Slice 6). La tienda REGISTRA pagos que ya verificó por fuera (Nakama no cobra ni procesa).
 * "Registrar pago" usa una `recordOperationKey` estable por intento (idempotencia: se reutiliza en reintentos,
 * se rota tras un resultado definitivo). No hay edición, borrado ni anulación en esta slice.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatArsCents, paymentStatusLabel, paymentMethodLabel, retailErrorLabel } from "@/lib/retail/format";
import { PAYMENT_METHOD } from "@/lib/domain/retail/payment";
import { registerPaymentAction } from "./paymentActions";

interface Payment { id: number; amountCents: number; method: string; paidAt: string; confirmedByUserId: string | null; note: string | null; createdAt: string }
interface Summary { totalCents: number; paidCents: number; remainingCents: number; paymentStatus: string }

const today = () => new Date().toISOString().slice(0, 10);

export default function Payments({ slug, campaignId, orderId, summary, payments, canRegister }: {
  slug: string; campaignId: number; orderId: number; summary: Summary; payments: Payment[]; canRegister: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(PAYMENT_METHOD.TRANSFER);
  const [paidAt, setPaidAt] = useState(today());
  const [note, setNote] = useState("");
  const keyRef = useRef<string | null>(null); // clave estable por intento; se rota tras resultado definitivo

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-AR") : "—");
  const isOverpaid = summary.paymentStatus === "OVERPAID";

  const submit = () => {
    if (pending) return;
    setError(null);
    if (!amount.trim()) { setError("Ingresá un monto."); return; }
    const key = keyRef.current ?? crypto.randomUUID();
    keyRef.current = key;
    startTransition(async () => {
      try {
        const res = await registerPaymentAction(slug, campaignId, orderId, { amountPesos: amount, method, paidAt, note: note.trim() || null }, key);
        keyRef.current = null; // resultado definitivo → rotar clave
        if (res.ok) { setAmount(""); setNote(""); router.refresh(); }
        else setError(retailErrorLabel(res.error));
      } catch {
        setError("No pudimos confirmar el registro. Reintentá."); // resultado incierto → conservar la clave
      }
    });
  };

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Pagos</h2>

      <div className="mt-3 rounded-xl border border-border p-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-xs text-muted">Total</p><p className="font-semibold">{formatArsCents(summary.totalCents)}</p></div>
          <div><p className="text-xs text-muted">Pagado</p><p className="font-semibold">{formatArsCents(summary.paidCents)}</p></div>
          <div><p className="text-xs text-muted">Restante</p><p className="font-semibold">{formatArsCents(summary.remainingCents)}</p></div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isOverpaid ? "bg-amber-500/15 text-amber-700" : "bg-surface"}`}>{paymentStatusLabel(summary.paymentStatus)}</span>
          {isOverpaid && <span className="text-xs text-amber-700">Revisá: se registró más que el total.</span>}
        </div>
      </div>

      {canRegister && (
        <div className="mt-4 rounded-xl border border-border p-4">
          <p className="text-sm font-medium">Registrar pago</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-xs text-muted">Monto (pesos)</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={pending} placeholder="0,00" className="mt-1 h-9 w-full rounded-md border border-border px-2" />
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Método</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={pending} className="mt-1 h-9 w-full rounded-md border border-border px-2">
                {Object.values(PAYMENT_METHOD).map((m) => <option key={m} value={m}>{paymentMethodLabel(m)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Fecha de pago</span>
              <input type="date" value={paidAt} max={today()} onChange={(e) => setPaidAt(e.target.value)} disabled={pending} className="mt-1 h-9 w-full rounded-md border border-border px-2" />
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Nota interna (opcional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} maxLength={500} placeholder="banco, nº de operación…" className="mt-1 h-9 w-full rounded-md border border-border px-2" />
            </label>
          </div>
          <button type="button" onClick={submit} disabled={pending} className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Registrar pago</button>
          <p className="mt-2 text-xs text-muted">Registrás un pago ya recibido. Nakama no procesa ni cobra el pago. La nota es interna.</p>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
            <span className="min-w-0">
              <span className="font-semibold">{formatArsCents(p.amountCents)}</span> <span className="text-muted">· {paymentMethodLabel(p.method)} · {fmt(p.paidAt)}</span>
              {p.note && <span className="block truncate text-xs text-muted">{p.note}</span>}
            </span>
          </li>
        ))}
        {payments.length === 0 && <li className="text-sm text-muted">Sin pagos registrados.</li>}
      </ul>

      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
