import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { isEnabled } from "@/lib/featureFlags";
import { loadStudioState, type StudioState } from "@/lib/retail/studio";
import { RetailError } from "@/lib/domain/retail/errors";
import { StudioScreen } from "@/components/store-preventas/studio/StudioScreen";

export const metadata = { title: "Nueva preventa · Tienda · Nakama" };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Estudio SaaS de creación/edición de una preventa (borrador). Requiere miembro OWNER/STAFF y tienda habilitada. */
export default async function NuevaPreventaPage({
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
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: true });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  // Continuar un borrador existente (?draft=id), verificando que sea de esta tienda.
  let initialState: StudioState | null = null;
  const draftId = Number(first(sp.draft));
  if (Number.isInteger(draftId) && draftId > 0) {
    try {
      initialState = await loadStudioState(draftId, ctx.userId, ctx.profileRow.storeId);
    } catch (err) {
      if (!(err instanceof RetailError || err instanceof StoreAuthError)) throw err; // borrador ajeno/inexistente → arranca en limpio
    }
  }

  const manualEnabled = await isEnabled("retail-manual-offers");
  return <StudioScreen slug={slug} initialState={initialState} manualEnabled={manualEnabled} />;
}
