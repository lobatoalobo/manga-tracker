"use client";

/**
 * UI pública de RESERVA (Slice 3, §21). Selector de cantidad por oferta (0..MAX), subtotal por línea y total,
 * calculados en el cliente SOLO para mostrar — el servidor recalcula y es la fuente de verdad. Exige sesión
 * (si no hay, muestra CTA de login). Evita doble submit con `useTransition` + guardia. Tras confirmar,
 * redirige al detalle de la orden.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatArsCents } from "@/lib/retail/format";
import { retailErrorLabel } from "@/lib/retail/format";
import { MAX_LINE_QUANTITY } from "@/lib/domain/retail/order";
import { reserveAction } from "./actions";

export interface ReserveOffer {
  id: number;
  title: string;
  volumeNumber: number | null;
  publisher: string | null;
  listPriceCents: number;
  preorderPriceCents: number;
  discountPercent: number;
}

export default function ReserveForm({ campaignId, offers, authed, loginHref }: { campaignId: number; offers: ReserveOffer[]; authed: boolean; loginHref: string }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setOfferQty = (offerId: number, value: number) => {
    const q = Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.floor(value || 0)));
    setQty((prev) => ({ ...prev, [offerId]: q }));
  };

  const items = useMemo(() => offers.map((o) => ({ offer: o, quantity: qty[o.id] ?? 0 })).filter((r) => r.quantity > 0), [offers, qty]);
  const totalCents = useMemo(() => items.reduce((s, r) => s + r.offer.preorderPriceCents * r.quantity, 0), [items]);

  const confirm = () => {
    if (pending || items.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await reserveAction(campaignId, items.map((r) => ({ offerId: r.offer.id, quantity: r.quantity })), totalCents);
      if (res.ok) router.push(`/mis-compras/preventas/${res.publicCode}`);
      else setError(retailErrorLabel(res.error));
    });
  };

  return (
    <div className="mt-6">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {offers.map((o) => {
          const q = qty[o.id] ?? 0;
          return (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{o.title} {o.volumeNumber != null && <span className="font-medium">#{o.volumeNumber}</span>}</span>
                {o.publisher && <span className="block text-xs text-muted">{o.publisher}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-right">
                  <span className="font-semibold">{formatArsCents(o.preorderPriceCents)}</span>
                  {o.discountPercent > 0 && <span className="ml-1 text-xs text-green-600">-{o.discountPercent}%</span>}
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" aria-label="Menos" className="h-7 w-7 rounded-md border border-border" onClick={() => setOfferQty(o.id, q - 1)} disabled={pending}>−</button>
                  <input
                    type="number" min={0} max={MAX_LINE_QUANTITY} inputMode="numeric" value={q}
                    onChange={(e) => setOfferQty(o.id, Number(e.target.value))}
                    className="h-7 w-12 rounded-md border border-border text-center" disabled={pending}
                  />
                  <button type="button" aria-label="Más" className="h-7 w-7 rounded-md border border-border" onClick={() => setOfferQty(o.id, q + 1)} disabled={pending}>+</button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">{items.reduce((s, r) => s + r.quantity, 0)} unidades</span>
        <span className="text-lg font-bold">Total {formatArsCents(totalCents)}</span>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}

      {authed ? (
        <button
          type="button" onClick={confirm} disabled={pending || items.length === 0}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Confirmando…" : "Confirmar reserva"}
        </button>
      ) : (
        <a href={loginHref} className="mt-4 block w-full rounded-lg bg-accent px-4 py-3 text-center text-sm font-semibold text-white">
          Iniciá sesión para reservar
        </a>
      )}
      <p className="mt-3 text-center text-xs text-muted">La reserva no es un pago. Coordinás el pago y el retiro con la tienda.</p>
    </div>
  );
}
