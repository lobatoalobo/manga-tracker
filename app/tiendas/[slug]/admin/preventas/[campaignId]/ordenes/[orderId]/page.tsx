import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getStoreOrder } from "@/lib/retail/orders";
import { RetailError } from "@/lib/domain/retail/errors";
import { formatArsCents, orderStatusLabel } from "@/lib/retail/format";
import { ORDER_STATUS } from "@/lib/domain/retail/order";
import StoreCancelButton from "./StoreCancelButton";

export const metadata = { title: "Orden · Admin · Nakama" };

/** Detalle admin de una orden (§23): cliente, líneas, cantidades, precios, total. Aísla por storeId real. */
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
  if (order.storeId !== ctx.profileRow.storeId) notFound(); // aislamiento entre tiendas

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleString("es-AR") : "—");

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href={`/tiendas/${slug}/admin/preventas/${cId}/ordenes`} className="text-sm text-accent hover:underline">← Órdenes</Link>
      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{order.customerNameSnapshot ?? "Cliente"}</h1>
          {order.customerEmailSnapshot && <p className="text-sm text-muted">{order.customerEmailSnapshot}</p>}
        </div>
        <span className="rounded-full bg-surface px-3 py-1 text-sm">{orderStatusLabel(order.status)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{order.campaign.title} · Código {order.publicCode} · {fmtDate(order.createdAt)}</p>

      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {order.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{l.titleSnapshot} {l.volumeNumberSnapshot != null && <span className="font-medium">#{l.volumeNumberSnapshot}</span>}</span>
              {l.publisherSnapshot && <span className="block text-xs text-muted">{l.publisherSnapshot}{l.isbnSnapshot ? ` · ${l.isbnSnapshot}` : ""}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-muted">{l.quantity} × {formatArsCents(l.unitPreorderPriceCents)}</span>
              <span className="font-semibold">{formatArsCents(l.lineTotalCents)}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">{order.lines.reduce((s, l) => s + l.quantity, 0)} unidades</span>
        <span className="text-lg font-bold">Total {formatArsCents(order.totalCents)}</span>
      </div>

      {order.status === ORDER_STATUS.CANCELLED && (
        <p className="mt-4 text-sm text-muted">Cancelada {fmtDate(order.cancelledAt)}{order.cancellationReason ? ` · ${order.cancellationReason}` : ""}</p>
      )}
      {order.status === ORDER_STATUS.RESERVED && <StoreCancelButton slug={slug} campaignId={cId} orderId={order.id} />}
    </main>
  );
}
