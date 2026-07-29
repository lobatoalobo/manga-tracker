import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getCampaignFulfillment } from "@/lib/retail/fulfillment";
import { RetailError } from "@/lib/domain/retail/errors";

export const metadata = { title: "Cumplimiento · Admin · Nakama" };

/** Vista agregada por oferta de la demanda de una campaña (§16): reservado/pedido/llegado/cancelado/pendiente. */
export default async function CampaignFulfillmentPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
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
    data = await getCampaignFulfillment(id, ctx.userId);
  } catch (err) {
    if (err instanceof StoreAuthError || err instanceof RetailError) notFound();
    throw err;
  }
  if (data.campaign.storeId !== ctx.profileRow.storeId) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/tiendas/${slug}/admin/preventas/${id}`} className="text-sm text-accent hover:underline">← Campaña</Link>
        <span className="flex gap-4">
          <Link href={`/tiendas/${slug}/admin/preventas/${id}/ordenes`} className="text-sm text-accent hover:underline">Órdenes →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${id}/preparacion`} className="text-sm text-accent hover:underline">Preparación →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${id}/pagos`} className="text-sm text-accent hover:underline">Pagos →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${id}/avisos`} className="text-sm text-accent hover:underline">Avisos →</Link>
        </span>
      </div>
      <h1 className="mt-4 mb-6 text-2xl font-bold">Cumplimiento · {data.campaign.title}</h1>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2">Tomo</th>
              <th className="px-2 py-2 text-right">Reserv.</th>
              <th className="px-2 py-2 text-right">Pedido</th>
              <th className="px-2 py-2 text-right">Llegó</th>
              <th className="px-2 py-2 text-right">Informado</th>
              <th className="px-2 py-2 text-right">Sin informar</th>
              <th className="px-2 py-2 text-right">Cancel.</th>
              <th className="px-2 py-2 text-right">Pend.</th>
              <th className="px-2 py-2 text-right">Órdenes</th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((o) => (
              <tr key={o.offerId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{o.title} {o.volumeNumber != null && <span className="font-medium">#{o.volumeNumber}</span>}</td>
                <td className="px-2 py-2 text-right">{o.reserved}</td>
                <td className="px-2 py-2 text-right">{o.ordered}</td>
                <td className="px-2 py-2 text-right text-green-700">{o.arrived}</td>
                <td className="px-2 py-2 text-right">{o.notified}</td>
                <td className="px-2 py-2 text-right font-medium text-amber-700">{o.arrivedNotInformed}</td>
                <td className="px-2 py-2 text-right">{o.cancelled}</td>
                <td className="px-2 py-2 text-right font-medium">{o.pending}</td>
                <td className="px-2 py-2 text-right text-muted">{o.orderCount}</td>
              </tr>
            ))}
            {data.offers.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-3 text-muted">Todavía no hay demanda (sin órdenes activas).</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">Agrega las líneas de las órdenes activas de la campaña. Cerrar la campaña no detiene esta gestión.</p>
    </main>
  );
}
