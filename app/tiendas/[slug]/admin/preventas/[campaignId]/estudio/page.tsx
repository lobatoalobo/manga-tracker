import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { getStoreCampaign } from "@/lib/retail/campaigns";
import { toStudioOfferRow } from "@/lib/retail/studio";
import EstudioClient from "./EstudioClient";

export const metadata = { title: "Estudio · Edición · Nakama" };

/** Estudio de la edición (P-03): editor estructural de una campaña. Aísla por tienda (slug ↔ storeId). */
export default async function EstudioPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
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

  return (
    <main style={{ height: "100dvh" }}>
      <EstudioClient
        campaignId={campaign.id}
        status={campaign.status}
        titulo={campaign.title}
        weekLabel={campaign.weekLabel ?? ""}
        principalOfferId={campaign.principalOfferId}
        rows={campaign.offers.map(toStudioOfferRow)}
      />
    </main>
  );
}
