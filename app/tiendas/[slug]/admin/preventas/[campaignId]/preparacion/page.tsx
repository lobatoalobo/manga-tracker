import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getCampaignHandoff } from "@/lib/retail/handoff";
import { RetailError } from "@/lib/domain/retail/errors";

export const metadata = { title: "Preparación y retiro · Admin · Nakama" };

/** Vista agregada de preparación/retiro por oferta (§9). Solo órdenes activas. Estados derivados al leer. */
export default async function CampaignHandoffPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
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
    data = await getCampaignHandoff(id, ctx.userId);
  } catch (err) {
    if (err instanceof StoreAuthError || err instanceof RetailError) notFound();
    throw err;
  }
  if (data.campaign.storeId !== ctx.profileRow.storeId) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/tiendas/${slug}/admin/preventas/${id}`} className="text-sm text-accent hover:underline">← Campaña</Link>
        <Link href={`/tiendas/${slug}/admin/preventas/${id}/cumplimiento`} className="text-sm text-accent hover:underline">Cumplimiento →</Link>
      </div>
      <h1 className="mt-4 mb-1 text-2xl font-bold">Preparación y retiro · {data.campaign.title}</h1>
      <p className="mb-6 text-sm text-muted">Unidades llegadas, preparadas, listas para retirar y retiradas (órdenes activas).</p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2">Tomo</th>
              <th className="px-2 py-2 text-right">Reserv.</th>
              <th className="px-2 py-2 text-right">Llegó</th>
              <th className="px-2 py-2 text-right">Preparado</th>
              <th className="px-2 py-2 text-right">Listo</th>
              <th className="px-2 py-2 text-right">Retirado</th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((o) => (
              <tr key={o.offerId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{o.title} {o.volumeNumber != null && <span className="font-medium">#{o.volumeNumber}</span>}</td>
                <td className="px-2 py-2 text-right">{o.reserved}</td>
                <td className="px-2 py-2 text-right text-green-700">{o.arrived}</td>
                <td className="px-2 py-2 text-right">{o.prepared}</td>
                <td className="px-2 py-2 text-right font-medium text-green-700">{o.readyForPickup}</td>
                <td className="px-2 py-2 text-right">{o.pickedUp}</td>
              </tr>
            ))}
            {data.offers.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-3 text-muted">Todavía no hay demanda (sin órdenes activas).</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
