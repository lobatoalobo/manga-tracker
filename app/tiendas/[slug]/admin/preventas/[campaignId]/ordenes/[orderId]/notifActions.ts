"use server";

/**
 * Server actions de avisos de llegada (Slice 5) para la TIENDA. El servicio deriva la tienda/orden desde la
 * notificación o la línea (no confía en slug/ids del cliente). `sendOperationKey` (idempotencia del envío) lo
 * genera el cliente por intento. Traducen a `{ ok, error }`.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import {
  createArrivalNotificationDraft, updateArrivalNotificationDraft, cancelArrivalNotification, markArrivalNotificationSent,
} from "@/lib/retail/notifications";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(err: unknown): ActionResult {
  if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
  throw err;
}
const revalidate = (slug: string, campaignId: number, orderId: number) => {
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes/${orderId}`);
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/avisos`);
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/cumplimiento`);
};

export async function createArrivalDraftAction(slug: string, campaignId: number, orderId: number, items: { orderLineId: number; quantity: number }[]): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await createArrivalNotificationDraft({ orderId, items }, userId);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function updateArrivalDraftAction(slug: string, campaignId: number, orderId: number, notificationId: number, message: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await updateArrivalNotificationDraft(notificationId, message, userId);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function cancelArrivalDraftAction(slug: string, campaignId: number, orderId: number, notificationId: number): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await cancelArrivalNotification(notificationId, userId);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function markArrivalSentAction(slug: string, campaignId: number, orderId: number, notificationId: number, sendOperationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await markArrivalNotificationSent(notificationId, userId, sendOperationKey);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
