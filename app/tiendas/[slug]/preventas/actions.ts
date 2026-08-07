"use server";

/**
 * Server actions del módulo Preventas (shell SaaS). Adaptadores DELGADOS sesión → servicios de dominio reales
 * (mismos que el flujo admin). No hay lógica de negocio nueva acá; los servicios autorizan por `storeId`
 * derivado de la entidad (nunca confían en el slug). Las mutaciones del estudio devuelven el StudioState fresco
 * para que la pantalla se re-renderice desde datos reales tras cada gesto.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { getCommerceProfileBySlug } from "@/lib/storeCommerce";
import { createPreorderCampaign, updateCampaign, publishPreorderCampaign } from "@/lib/retail/campaigns";
import {
  addPreorderOffer,
  updatePreorderOffer,
  hidePreorderOffer,
  showPreorderOffer,
  cancelPreorderOffer,
  removeDraftPreorderOffer,
} from "@/lib/retail/offers";
import { searchOfferVolumes, type OfferVolumeCandidate } from "@/lib/retail/volumeSearch";
import { isEnabled } from "@/lib/featureFlags";
import { loadStudioState, listableOffers, type StudioState } from "@/lib/retail/studio";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

const dateOrNull = (v: string | null): Date | null => {
  const t = (v ?? "").trim();
  return t ? new Date(t) : null;
};

function toError(err: unknown): { ok: false; error: string } {
  if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
  throw err; // errores no de dominio → error boundary
}

async function storeIdOf(slug: string): Promise<number> {
  const p = await getCommerceProfileBySlug(slug);
  if (!p) throw new StoreAuthError("PROFILE_NOT_FOUND");
  return p.storeId;
}

/** Devuelve el campaignId; si aún no existe, crea el borrador (con nombre placeholder si falta). */
async function ensureDraft(slug: string, campaignId: number | null, userId: string, title: string): Promise<number> {
  if (campaignId != null) return campaignId;
  const storeId = await storeIdOf(slug);
  const c = await createPreorderCampaign({ storeId, title: title.trim() || "Preventa sin nombre" }, userId);
  return c.id;
}

// ============================================================================
// Alta simple (compat con la pantalla previa)
// ============================================================================
export interface NewCampaignInput {
  title: string;
  description: string;
  opensAt: string | null;
  closesAt: string | null;
}
export type CreateCampaignResult = { ok: true; id: number } | { ok: false; error: string };

export async function createStoreCampaignAction(slug: string, input: NewCampaignInput): Promise<CreateCampaignResult> {
  try {
    const userId = await requireUserId();
    const storeId = await storeIdOf(slug);
    const c = await createPreorderCampaign(
      { storeId, title: input.title, description: input.description, opensAt: dateOrNull(input.opensAt), closesAt: dateOrNull(input.closesAt) },
      userId,
    );
    revalidatePath(`/tiendas/${slug}/preventas`);
    return { ok: true, id: c.id };
  } catch (err) {
    return toError(err);
  }
}

// ============================================================================
// Estudio SaaS
// ============================================================================
export type StudioResult = { ok: true; state: StudioState } | { ok: false; error: string };

const ok = async (campaignId: number, userId: string): Promise<StudioResult> => ({ ok: true, state: await loadStudioState(campaignId, userId) });

/** Datos generales: crea o actualiza el borrador (nombre, apertura, cierre, descripción). */
export async function saveGeneralAction(
  slug: string,
  campaignId: number | null,
  g: { title: string; opensAt: string | null; closesAt: string | null; description: string },
): Promise<StudioResult> {
  try {
    const userId = await requireUserId();
    if (campaignId == null) {
      const storeId = await storeIdOf(slug);
      const c = await createPreorderCampaign(
        { storeId, title: g.title, description: g.description, opensAt: dateOrNull(g.opensAt), closesAt: dateOrNull(g.closesAt) },
        userId,
      );
      revalidatePath(`/tiendas/${slug}/preventas`);
      return ok(c.id, userId);
    }
    await updateCampaign(
      campaignId,
      { title: g.title || undefined, description: g.description, opensAt: dateOrNull(g.opensAt), closesAt: dateOrNull(g.closesAt) },
      userId,
    );
    revalidatePath(`/tiendas/${slug}/preventas`);
    return ok(campaignId, userId);
  } catch (err) {
    return toError(err);
  }
}

export interface ManualOfferRow {
  title: string;
  volumeNumber: number | null;
  publisher: string | null;
  isbn: string | null;
  listPriceCents: number;
  preorderPriceCents: number;
  isReprint: boolean;
  publisherDiscountPct: number | null;
}

/** Agrega UNA oferta manual (novedad que aún no está en el catálogo). Gateada por `retail-manual-offers`. */
export async function addManualOfferAction(slug: string, campaignId: number | null, row: ManualOfferRow): Promise<StudioResult> {
  try {
    if (!(await isEnabled("retail-manual-offers"))) return { ok: false, error: "FEATURE_DISABLED" };
    const userId = await requireUserId();
    const id = await ensureDraft(slug, campaignId, userId, row.title);
    await addPreorderOffer(
      {
        campaignId: id,
        mode: "manual",
        descriptor: { title: row.title, volumeNumber: row.volumeNumber, publisher: row.publisher, isbn: row.isbn },
        listPriceCents: row.listPriceCents,
        preorderPriceCents: row.preorderPriceCents,
        isReprint: row.isReprint,
        publisherDiscountPct: row.publisherDiscountPct,
      },
      userId,
    );
    revalidatePath(`/tiendas/${slug}/preventas`);
    return ok(id, userId);
  } catch (err) {
    return toError(err);
  }
}

/** Agrega varias ofertas manuales revisadas (WhatsApp / archivo). Las que fallan se saltan sin abortar el lote. */
export async function addManualOffersAction(slug: string, campaignId: number | null, rows: ManualOfferRow[]): Promise<StudioResult> {
  try {
    if (!(await isEnabled("retail-manual-offers"))) return { ok: false, error: "FEATURE_DISABLED" };
    if (rows.length === 0) return { ok: false, error: "EMPTY_ORDER" };
    const userId = await requireUserId();
    const id = await ensureDraft(slug, campaignId, userId, rows[0]?.title ?? "");
    for (const row of rows) {
      try {
        await addPreorderOffer(
          {
            campaignId: id,
            mode: "manual",
            descriptor: { title: row.title, volumeNumber: row.volumeNumber, publisher: row.publisher, isbn: row.isbn },
            listPriceCents: row.listPriceCents,
            preorderPriceCents: row.preorderPriceCents,
            isReprint: row.isReprint,
            publisherDiscountPct: row.publisherDiscountPct,
          },
          userId,
        );
      } catch (err) {
        if (!(err instanceof RetailError)) throw err; // solo tolera errores de dominio (p. ej. precio) por fila
      }
    }
    revalidatePath(`/tiendas/${slug}/preventas`);
    return ok(id, userId);
  } catch (err) {
    return toError(err);
  }
}

/** Agrega una oferta vinculada a un tomo REAL del catálogo. No gateada. */
export async function addCatalogOfferAction(
  slug: string,
  campaignId: number | null,
  input: { volumeId: number; listPriceCents: number; preorderPriceCents: number; isReprint: boolean; publisherDiscountPct: number | null; title?: string },
): Promise<StudioResult> {
  try {
    const userId = await requireUserId();
    const id = await ensureDraft(slug, campaignId, userId, input.title ?? "");
    await addPreorderOffer(
      { campaignId: id, mode: "linked", volumeId: input.volumeId, listPriceCents: input.listPriceCents, preorderPriceCents: input.preorderPriceCents, isReprint: input.isReprint, publisherDiscountPct: input.publisherDiscountPct },
      userId,
    );
    revalidatePath(`/tiendas/${slug}/preventas`);
    return ok(id, userId);
  } catch (err) {
    return toError(err);
  }
}

/** Busca tomos del catálogo (picker de ofertas vinculadas). */
export async function searchCatalogAction(query: string): Promise<OfferVolumeCandidate[]> {
  await requireUserId();
  return searchOfferVolumes(query);
}

/** Edita una oferta (precios / reimpresión / descuento). */
export async function updateStudioOfferAction(
  slug: string,
  campaignId: number,
  offerId: number,
  patch: { listPriceCents?: number; preorderPriceCents?: number; isReprint?: boolean; publisherDiscountPct?: number | null },
): Promise<StudioResult> {
  try {
    const userId = await requireUserId();
    await updatePreorderOffer(offerId, patch, userId);
    return ok(campaignId, userId);
  } catch (err) {
    return toError(err);
  }
}

/** Adelantar/Atrasar: reindexa el sortOrder de las ofertas listables tras el swap. */
export async function reorderStudioOfferAction(slug: string, campaignId: number, offerId: number, dir: "up" | "down"): Promise<StudioResult> {
  try {
    const userId = await requireUserId();
    const state = await loadStudioState(campaignId, userId);
    const list = listableOffers(state);
    const idx = list.findIndex((o) => o.id === offerId);
    if (idx < 0) return { ok: false, error: "OFFER_NOT_FOUND" };
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= list.length) return { ok: true, state }; // borde: no-op
    [list[idx], list[swap]] = [list[swap], list[idx]];
    for (let i = 0; i < list.length; i++) {
      if (list[i].sortOrder !== i) await updatePreorderOffer(list[i].id, { sortOrder: i }, userId);
    }
    return ok(campaignId, userId);
  } catch (err) {
    return toError(err);
  }
}

/** Pausar/Reanudar/Dar de baja/Sacar de la edición. */
export async function setStudioOfferStatusAction(slug: string, campaignId: number, offerId: number, op: "pause" | "resume" | "cancel" | "remove"): Promise<StudioResult> {
  try {
    const userId = await requireUserId();
    if (op === "pause") await hidePreorderOffer(offerId, userId);
    else if (op === "resume") await showPreorderOffer(offerId, userId);
    else if (op === "cancel") await cancelPreorderOffer(offerId, userId);
    else await removeDraftPreorderOffer(offerId, userId);
    return ok(campaignId, userId);
  } catch (err) {
    return toError(err);
  }
}

/** Publica la campaña (valida ≥1 oferta activa, título, fechas, tienda habilitada). */
export async function publishStudioAction(slug: string, campaignId: number): Promise<StudioResult> {
  try {
    const userId = await requireUserId();
    await publishPreorderCampaign(campaignId, userId);
    revalidatePath(`/tiendas/${slug}/preventas`);
    return ok(campaignId, userId);
  } catch (err) {
    return toError(err);
  }
}
