"use server";

/**
 * Server actions de preventas (Slice 2): adaptadores DELGADOS sesión → servicios de dominio. Obtienen el
 * `userId` de la sesión y delegan; los servicios autorizan por `storeId` derivado de la entidad (nunca del
 * slug del cliente). Traducen errores de dominio a un resultado `{ ok, error }` para los forms.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { getCommerceProfileBySlug } from "@/lib/storeCommerce";
import {
  createPreorderCampaign,
  updateCampaign,
  publishPreorderCampaign,
  closePreorderCampaign,
  cancelPreorderCampaign,
  removeDraftPreorderCampaign,
} from "@/lib/retail/campaigns";
import { addPreorderOffer, updatePreorderOffer, hidePreorderOffer, showPreorderOffer, cancelPreorderOffer, removeDraftPreorderOffer } from "@/lib/retail/offers";
import { searchOfferVolumes, type OfferVolumeCandidate } from "@/lib/retail/volumeSearch";
import { isEnabled } from "@/lib/featureFlags";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(err: unknown): { ok: false; error: string } {
  if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
  throw err; // errores no de dominio propagan (error boundary)
}

const str = (fd: FormData, k: string) => ((fd.get(k) as string | null) ?? "").trim();
const dateOrNull = (fd: FormData, k: string): Date | null => {
  const v = str(fd, k);
  return v ? new Date(v) : null;
};
const pesosToCents = (fd: FormData, k: string): number => Math.round(Number(str(fd, k) || "0") * 100);

async function storeIdOf(slug: string): Promise<number> {
  const p = await getCommerceProfileBySlug(slug);
  if (!p) throw new StoreAuthError("PROFILE_NOT_FOUND");
  return p.storeId;
}

// --- campaña ---
export async function createCampaignAction(slug: string, fd: FormData): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const userId = await requireUserId();
    const storeId = await storeIdOf(slug);
    const c = await createPreorderCampaign(
      { storeId, title: str(fd, "title"), description: str(fd, "description"), weekLabel: str(fd, "weekLabel"), opensAt: dateOrNull(fd, "opensAt"), closesAt: dateOrNull(fd, "closesAt") },
      userId,
    );
    revalidatePath(`/tiendas/${slug}/admin/preventas`);
    return { ok: true, id: c.id };
  } catch (err) {
    return toError(err);
  }
}

export async function updateCampaignAction(slug: string, campaignId: number, fd: FormData): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await updateCampaign(campaignId, { title: str(fd, "title") || undefined, description: str(fd, "description"), weekLabel: str(fd, "weekLabel"), opensAt: dateOrNull(fd, "opensAt"), closesAt: dateOrNull(fd, "closesAt") }, userId);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

const campaignOp = (fn: (id: number, userId: string) => Promise<unknown>) =>
  async function (slug: string, campaignId: number): Promise<ActionResult> {
    try {
      const userId = await requireUserId();
      await fn(campaignId, userId);
      revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}`);
      revalidatePath(`/tiendas/${slug}/admin/preventas`);
      return { ok: true };
    } catch (err) {
      return toError(err);
    }
  };

export const publishCampaignAction = campaignOp((id, u) => publishPreorderCampaign(id, u));
export const closeCampaignAction = campaignOp((id, u) => closePreorderCampaign(id, u));
export const cancelCampaignAction = campaignOp((id, u) => cancelPreorderCampaign(id, u));
export const deleteDraftCampaignAction = campaignOp((id, u) => removeDraftPreorderCampaign(id, u));

// --- ofertas ---
export async function searchVolumesAction(query: string): Promise<OfferVolumeCandidate[]> {
  await requireUserId(); // solo usuarios logueados; la selección se persiste vía addOfferAction (autorizada)
  return searchOfferVolumes(query);
}

/**
 * Agrega una oferta. Convierte el form a una entrada DISCRIMINADA explícita (nunca ambigua):
 *  - `mode=manual` → `{ mode: "manual", descriptor }`, gateado por el flag `retail-manual-offers`. La
 *    re-validación del flag es SERVER-SIDE: un request manual por fuera de la UI se rechaza con el flag apagado.
 *  - resto (default / `mode=linked`) → `{ mode: "linked", volumeId }`, comportamiento histórico NO gateado.
 * El flag solo gatea la ESCRITURA manual; nunca la lectura ni el picker vinculado.
 */
export async function addOfferAction(slug: string, campaignId: number, fd: FormData): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const listPriceCents = pesosToCents(fd, "listPrice");
    const preorderPriceCents = pesosToCents(fd, "preorderPrice");

    if (str(fd, "mode") === "manual") {
      if (!(await isEnabled("retail-manual-offers"))) return { ok: false, error: "FEATURE_DISABLED" };
      const volumeNumberRaw = str(fd, "volumeNumber");
      await addPreorderOffer(
        {
          campaignId,
          mode: "manual",
          descriptor: {
            title: str(fd, "title"),
            volumeNumber: volumeNumberRaw === "" ? null : Number(volumeNumberRaw),
            publisher: str(fd, "publisher") || null,
            isbn: str(fd, "isbn") || null,
          },
          listPriceCents,
          preorderPriceCents,
        },
        userId,
      );
    } else {
      await addPreorderOffer({ campaignId, mode: "linked", volumeId: Number(str(fd, "volumeId")), listPriceCents, preorderPriceCents }, userId);
    }
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

const offerOp = (fn: (offerId: number, userId: string) => Promise<unknown>) =>
  async function (slug: string, campaignId: number, offerId: number): Promise<ActionResult> {
    try {
      const userId = await requireUserId();
      await fn(offerId, userId);
      revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}`);
      return { ok: true };
    } catch (err) {
      return toError(err);
    }
  };

export const hideOfferAction = offerOp((id, u) => hidePreorderOffer(id, u));
export const showOfferAction = offerOp((id, u) => showPreorderOffer(id, u));
export const cancelOfferAction = offerOp((id, u) => cancelPreorderOffer(id, u));
export const removeOfferAction = offerOp((id, u) => removeDraftPreorderOffer(id, u));

export async function updateOfferAction(slug: string, campaignId: number, offerId: number, fd: FormData): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await updatePreorderOffer(offerId, { listPriceCents: pesosToCents(fd, "listPrice"), preorderPriceCents: pesosToCents(fd, "preorderPrice") }, userId);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
