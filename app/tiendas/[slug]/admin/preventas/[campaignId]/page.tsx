import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getStoreCampaign } from "@/lib/retail/campaigns";
import { derivedDiscountPercent } from "@/lib/domain/retail/offer";
import { isEnabled } from "@/lib/featureFlags";
import CampaignAdminClient from "./CampaignAdminClient";

export const metadata = { title: "Campaña · Admin · Nakama" };

/** Detalle admin de una campaña (§14): datos, estado, ofertas, picker. Aísla por tienda (slug ↔ storeId). */
export default async function CampaignDetailPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const id = Number(campaignId);

  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  const campaign = await getStoreCampaign(id, ctx.userId).catch(() => null);
  if (!campaign || campaign.storeId !== ctx.profileRow.storeId) notFound(); // aislamiento entre tiendas

  const view = {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description,
    weekLabel: campaign.weekLabel,
    status: campaign.status,
    opensAt: campaign.opensAt?.toISOString() ?? null,
    closesAt: campaign.closesAt?.toISOString() ?? null,
    publishedAt: campaign.publishedAt?.toISOString() ?? null,
  };
  const offers = campaign.offers.map((o) => ({
    id: o.id, volumeId: o.volumeId, title: o.titleSnapshot, volumeNumber: o.volumeNumberSnapshot, publisher: o.publisherSnapshot,
    listPriceCents: o.listPriceCents, preorderPriceCents: o.preorderPriceCents,
    discountPercent: derivedDiscountPercent(o.listPriceCents, o.preorderPriceCents), status: o.status,
  }));
  // Solo la CREACIÓN manual está gateada; la lectura de las ofertas (incl. manuales) no depende del flag.
  const manualOffersEnabled = await isEnabled("retail-manual-offers");

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/tiendas/${slug}/admin/preventas`} className="text-sm text-accent hover:underline">← Preventas</Link>
        <span className="flex gap-4">
          <Link href={`/tiendas/${slug}/admin/preventas/${campaign.id}/estudio`} className="text-sm font-medium text-accent hover:underline">Abrir en el Estudio →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${campaign.id}/ordenes`} className="text-sm text-accent hover:underline">Órdenes →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${campaign.id}/cumplimiento`} className="text-sm text-accent hover:underline">Cumplimiento →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${campaign.id}/preparacion`} className="text-sm text-accent hover:underline">Preparación →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${campaign.id}/pagos`} className="text-sm text-accent hover:underline">Pagos →</Link>
          <Link href={`/tiendas/${slug}/admin/preventas/${campaign.id}/avisos`} className="text-sm text-accent hover:underline">Avisos →</Link>
        </span>
      </div>
      <h1 className="mt-4 mb-6 text-2xl font-bold">{campaign.title}</h1>
      <CampaignAdminClient slug={slug} campaign={view} offers={offers} manualOffersEnabled={manualOffersEnabled} />
    </main>
  );
}
