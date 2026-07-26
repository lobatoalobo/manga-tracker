import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { getCustomerOrder } from "@/lib/retail/orders";
import { getOrderFulfillmentSummary } from "@/lib/domain/retail/fulfillment";
import { RetailError } from "@/lib/domain/retail/errors";
import { formatArsCents, orderStatusLabel, orderFulfillmentLabel, fulfillmentStatusLabel, paymentStatusLabel, paymentMethodLabel } from "@/lib/retail/format";
import { computeRemainingCents } from "@/lib/domain/retail/payment";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import CancelOrderButton from "../CancelOrderButton";

export const metadata = { title: "Reserva · Nakama" };

/** Detalle de una reserva del cliente (§22). Verifica propiedad; sin controles de pago/retiro. */
export default async function MyOrderDetailPage({ params }: { params: Promise<{ publicCode: string }> }) {
  const { publicCode } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/api/auth/signin?callbackUrl=/mis-compras/preventas/${publicCode}`);

  let order;
  try {
    order = await getCustomerOrder(publicCode, session.user.id);
  } catch (err) {
    if (err instanceof RetailError) notFound(); // ORDER_NOT_FOUND / ORDER_ACCESS_DENIED → 404 (no filtra existencia)
    throw err;
  }

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" }) : "—");

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/mis-compras/preventas" className="text-sm text-accent hover:underline">← Mis preventas</Link>
      <div className="mt-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{order.store.name}</p>
          <h1 className="text-2xl font-bold">{order.campaign.title}</h1>
          {order.campaign.weekLabel && <p className="text-sm text-muted">{order.campaign.weekLabel}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-surface px-3 py-1 text-sm">{orderStatusLabel(order.status)}</span>
          {order.status === ORDER_STATUS.RESERVED && <span className="text-xs text-muted">{orderFulfillmentLabel(getOrderFulfillmentSummary(order.lines))}</span>}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">Código {order.publicCode} · {fmtDate(order.createdAt)}</p>

      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {order.lines.map((l) => {
          const pending = l.quantity - l.arrivedQuantity - l.cancelledQuantity;
          const partial = l.arrivedQuantity > 0 && pending > 0;
          const lineLabel = partial ? `Recibido ${l.arrivedQuantity} de ${l.quantity}` : fulfillmentStatusLabel(l.fulfillmentStatus);
          return (
            <li key={l.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{l.titleSnapshot} {l.volumeNumberSnapshot != null && <span className="font-medium">#{l.volumeNumberSnapshot}</span>}</span>
                <span className="block text-xs text-muted">{l.quantity} u · {lineLabel}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-muted">{l.quantity} × {formatArsCents(l.unitPreorderPriceCents)}</span>
                <span className="font-semibold">{formatArsCents(l.lineTotalCents)}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">{order.lines.reduce((s, l) => s + l.quantity, 0)} unidades</span>
        <span className="text-lg font-bold">Total {formatArsCents(order.totalCents)}</span>
      </div>

      <p className="mt-4 text-xs text-muted">La reserva no es un pago. Coordiná el pago y el retiro con la tienda.</p>
      {order.status === ORDER_STATUS.RESERVED && <CancelOrderButton publicCode={order.publicCode} />}

      {(order.paymentStatus !== "UNPAID" || order.payments.length > 0) && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Estado de pago</h2>
          <div className="mt-3 rounded-xl border border-border p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-surface px-3 py-1 text-xs">{paymentStatusLabel(order.paymentStatus)}</span>
              <span className="text-muted">Pagado {formatArsCents(order.paidCents)} de {formatArsCents(order.totalCents)}</span>
            </div>
            {computeRemainingCents(order.totalCents, order.paidCents) > 0 && (
              <p className="mt-2 text-xs text-muted">Restante: {formatArsCents(computeRemainingCents(order.totalCents, order.paidCents))}</p>
            )}
            {order.payments.length > 0 && (
              <ul className="mt-3 space-y-1">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted">{new Date(p.paidAt).toLocaleDateString("es-AR")} · {paymentMethodLabel(p.method)}</span>
                    <span className="font-medium">{formatArsCents(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">La tienda registró estos pagos. Nakama no procesa el cobro.</p>
        </section>
      )}

      {order.notifications.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Avisos de la tienda</h2>
          <ul className="mt-3 space-y-3">
            {order.notifications.map((n) => (
              <li key={n.id} className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted">{n.sentAt ? new Date(n.sentAt).toLocaleString("es-AR") : ""}</p>
                <pre className="mt-1 whitespace-pre-wrap text-sm">{n.messageSnapshot}</pre>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
