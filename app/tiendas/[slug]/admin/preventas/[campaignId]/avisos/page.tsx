import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { listPendingArrivalNotifications } from "@/lib/retail/notifications";
import { RetailError } from "@/lib/domain/retail/errors";

export const metadata = { title: "Avisos · Admin · Nakama" };

/** Órdenes de la campaña con unidades llegadas aún no informadas (§19). Punto de entrada para preparar avisos. */
export default async function CampaignNotificationsPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const id = Number(campaignId);

  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  let data;
  try {
    data = await listPendingArrivalNotifications(id, ctx.userId);
  } catch (err) {
    if (err instanceof StoreAuthError || err instanceof RetailError) notFound();
    throw err;
  }
  if (data.campaign.storeId !== ctx.profileRow.storeId) notFound();

  const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("es-AR") : "—");

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/tiendas/${slug}/admin/preventas/${id}`} className="text-sm text-accent hover:underline">← Campaña</Link>
        <Link href={`/tiendas/${slug}/admin/preventas/${id}/cumplimiento`} className="text-sm text-accent hover:underline">Cumplimiento →</Link>
      </div>
      <h1 className="mt-4 mb-2 text-2xl font-bold">Avisos pendientes · {data.campaign.title}</h1>
      <p className="mb-6 text-sm text-muted">Órdenes con unidades que llegaron a la tienda y todavía no se informaron.</p>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {data.orders.map((o) => (
          <li key={o.orderId} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/tiendas/${slug}/admin/preventas/${id}/ordenes/${o.orderId}`} className="min-w-0">
              <span className="block truncate font-medium hover:underline">{o.customerName ?? "Cliente"}</span>
              <span className="block text-xs text-muted">{o.publicCode} · última llegada {fmt(o.lastArrivalAt)}</span>
            </Link>
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">{o.pendingUnnotified} sin informar</span>
          </li>
        ))}
        {data.orders.length === 0 && <li className="px-4 py-3 text-sm text-muted">No hay avisos pendientes.</li>}
      </ul>
    </main>
  );
}
