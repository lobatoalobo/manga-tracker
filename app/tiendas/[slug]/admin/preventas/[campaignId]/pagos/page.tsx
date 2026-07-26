import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getCampaignPaymentSummary, listPendingPayments } from "@/lib/retail/payments";
import { RetailError } from "@/lib/domain/retail/errors";
import { formatArsCents, paymentStatusLabel } from "@/lib/retail/format";

export const metadata = { title: "Pagos · Admin · Nakama" };

/** Vista agregada de pagos de una campaña (§12): totales, % cobrado, conteo por estado y órdenes con saldo. */
export default async function CampaignPaymentsPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const id = Number(campaignId);

  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  let summary, pending;
  try {
    [summary, pending] = await Promise.all([getCampaignPaymentSummary(id, ctx.userId), listPendingPayments(id, ctx.userId)]);
  } catch (err) {
    if (err instanceof StoreAuthError || err instanceof RetailError) notFound();
    throw err;
  }
  if (summary.campaign.storeId !== ctx.profileRow.storeId) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/tiendas/${slug}/admin/preventas/${id}`} className="text-sm text-accent hover:underline">← Campaña</Link>
        <Link href={`/tiendas/${slug}/admin/preventas/${id}/cumplimiento`} className="text-sm text-accent hover:underline">Cumplimiento →</Link>
      </div>
      <h1 className="mt-4 mb-1 text-2xl font-bold">Pagos · {summary.campaign.title}</h1>
      <p className="mb-6 text-sm text-muted">Métricas sobre órdenes activas (excluye canceladas). Nakama no procesa el cobro.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted">Órdenes</p><p className="text-lg font-bold">{summary.orderCount}</p></div>
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted">Facturado</p><p className="text-lg font-bold">{formatArsCents(summary.billedCents)}</p></div>
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted">Cobrado</p><p className="text-lg font-bold">{formatArsCents(summary.paidCents)}</p></div>
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted">% cobrado</p><p className="text-lg font-bold">{summary.collectedPercent}%</p></div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {(["UNPAID", "PARTIALLY_PAID", "PAID", "OVERPAID"] as const).map((s) => (
          <span key={s} className="rounded-full bg-surface px-3 py-1">{paymentStatusLabel(s)}: <strong>{summary.byStatus[s] ?? 0}</strong></span>
        ))}
      </div>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Órdenes con saldo pendiente</h2>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {pending.orders.map((o) => (
          <li key={o.orderId} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/tiendas/${slug}/admin/preventas/${id}/ordenes/${o.orderId}`} className="min-w-0">
              <span className="block truncate font-medium hover:underline">{o.customerName ?? "Cliente"}</span>
              <span className="block text-xs text-muted">{o.publicCode} · {paymentStatusLabel(o.paymentStatus)}</span>
            </Link>
            <span className="shrink-0 text-right">
              <span className="block font-semibold">{formatArsCents(o.remainingCents)}</span>
              <span className="block text-xs text-muted">de {formatArsCents(o.totalCents)}</span>
            </span>
          </li>
        ))}
        {pending.orders.length === 0 && <li className="px-4 py-3 text-sm text-muted">No hay órdenes con saldo pendiente.</li>}
      </ul>
    </main>
  );
}
