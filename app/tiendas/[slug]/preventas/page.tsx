import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { loadPreordersDashboard } from "@/lib/retail/preorders-dashboard";
import { PreventasScreen } from "@/components/store-preventas/PreventasScreen";

export const metadata = { title: "Preventas · Tienda · Nakama" };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Home del módulo Preventas (datos reales). Solo miembros de la tienda (requireEnabled:false, como el panel admin). */
export default async function PreventasPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  const data = await loadPreordersDashboard(ctx.profileRow.storeId, {
    q: first(sp.q),
    stage: first(sp.stage),
    sort: first(sp.sort),
    page: Number(first(sp.page)) || 1,
  });

  return <PreventasScreen data={data} slug={slug} />;
}
