import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getStoreOrder } from "@/lib/retail/orders";
import { getOrderArrivalNotificationPreview, listOrderNotifications } from "@/lib/retail/notifications";
import { getOrderFulfillmentSummary } from "@/lib/domain/retail/fulfillment";
import { RetailError } from "@/lib/domain/retail/errors";
import { formatArsCents, orderStatusLabel, orderFulfillmentLabel, lineEventTypeLabel } from "@/lib/retail/format";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import StoreCancelButton from "./StoreCancelButton";
import LineFulfillmentControls from "./LineFulfillmentControls";
import ArrivalNotifications from "./ArrivalNotifications";

export const metadata = { title: "Orden · Admin · Nakama" };

/** Detalle admin de una orden (§15): cliente, líneas con cumplimiento por cantidad, historial y acciones. */
export default async function StoreOrderDetailPage({ params }: { params: Promise<{ slug: string; campaignId: string; orderId: string }> }) {
  const { slug, campaignId, orderId } = await params;
  const cId = Number(campaignId);

  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  let order;
  try {
    order = await getStoreOrder(Number(orderId), ctx.userId);
  } catch (err) {
    if (err instanceof StoreAuthError || err instanceof RetailError) notFound();
    throw err;
  }
  if (order.storeId !== ctx.profileRow.storeId) notFound();

  const summary = getOrderFulfillmentSummary(order.lines);
  const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString("es-AR") : "—");
  const canCancelOrder = order.status === ORDER_STATUS.RESERVED && order.lines.every((l) => l.orderedQuantity === 0 && l.arrivedQuantity === 0);

  // Avisos de llegada (Slice 5): preview de pendientes + historial. Solo si la orden no está cancelada.
  const [preview, notifications] = order.status === ORDER_STATUS.CANCELLED
    ? [null, []]
    : await Promise.all([getOrderArrivalNotificationPreview(order.id, ctx.userId), listOrderNotifications(order.id, ctx.userId)]);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/tiendas/${slug}/admin/preventas/${cId}/ordenes`} className="text-sm text-accent hover:underline">← Órdenes</Link>
        <Link href={`/tiendas/${slug}/admin/preventas/${cId}/cumplimiento`} className="text-sm text-accent hover:underline">Cumplimiento →</Link>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{order.customerNameSnapshot ?? "Cliente"}</h1>
          {order.customerEmailSnapshot && <p className="text-sm text-muted">{order.customerEmailSnapshot}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-surface px-3 py-1 text-sm">{orderStatusLabel(order.status)}</span>
          <span className="text-xs text-muted">{orderFulfillmentLabel(summary)}</span>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">{order.campaign.title} · Código {order.publicCode} · {fmt(order.createdAt)}</p>

      <div className="mt-6 space-y-4">
        {order.lines.map((l) => (
          <div key={l.id} className="space-y-2">
            {order.status === ORDER_STATUS.RESERVED ? (
              <LineFulfillmentControls
                slug={slug} campaignId={cId} orderId={order.id}
                line={{ id: l.id, title: l.titleSnapshot, volumeNumber: l.volumeNumberSnapshot, quantity: l.quantity, orderedQuantity: l.orderedQuantity, arrivedQuantity: l.arrivedQuantity, cancelledQuantity: l.cancelledQuantity, fulfillmentStatus: l.fulfillmentStatus }}
              />
            ) : (
              <div className="rounded-xl border border-border p-4 text-sm">
                <span className="font-medium">{l.titleSnapshot} {l.volumeNumberSnapshot != null && <span>#{l.volumeNumberSnapshot}</span>}</span>
                <p className="mt-1 text-xs text-muted">Reservado {l.quantity} · Llegó {l.arrivedQuantity} · Cancelado {l.cancelledQuantity}</p>
              </div>
            )}
            {l.events.length > 0 && (
              <details className="px-2 text-xs text-muted">
                <summary className="cursor-pointer">Historial ({l.events.length})</summary>
                <ul className="mt-1 space-y-1">
                  {l.events.map((e) => (
                    <li key={e.id}>{fmt(e.createdAt)} · {lineEventTypeLabel(e.type)} ×{e.quantity}{e.note ? ` · ${e.note}` : ""}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">{order.lines.reduce((s, l) => s + l.quantity, 0)} unidades reservadas</span>
        <span className="text-lg font-bold">Total {formatArsCents(order.totalCents)}</span>
      </div>

      {order.status === ORDER_STATUS.CANCELLED && (
        <p className="mt-4 text-sm text-muted">Orden cancelada {fmt(order.cancelledAt)}{order.cancellationReason ? ` · ${order.cancellationReason}` : ""}</p>
      )}
      {canCancelOrder && <StoreCancelButton slug={slug} campaignId={cId} orderId={order.id} />}
      {order.status === ORDER_STATUS.RESERVED && !canCancelOrder && (
        <p className="mt-6 text-xs text-muted">La operación de proveedor ya comenzó: cancelá unidades por línea; no se puede cancelar la orden completa.</p>
      )}

      {preview && (
        <ArrivalNotifications
          slug={slug} campaignId={cId} orderId={order.id}
          preview={{ lines: preview.lines, suggestedMessage: preview.suggestedMessage, hasPending: preview.hasPending }}
          notifications={notifications.map((n) => ({
            id: n.id, status: n.status, messageSnapshot: n.messageSnapshot,
            createdAt: n.createdAt.toISOString(), sentAt: n.sentAt?.toISOString() ?? null, cancelledAt: n.cancelledAt?.toISOString() ?? null,
            items: n.items.map((i) => ({ quantity: i.quantity, orderLine: { titleSnapshot: i.orderLine.titleSnapshot, volumeNumberSnapshot: i.orderLine.volumeNumberSnapshot } })),
          }))}
        />
      )}
    </main>
  );
}
