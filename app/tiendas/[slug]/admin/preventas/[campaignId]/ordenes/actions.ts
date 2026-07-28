"use server";

/**
 * Server action de cancelación de orden por la TIENDA (Slice 3). El servicio deriva el `storeId` de la
 * propia orden y autoriza al miembro (OWNER/STAFF); no confía en el slug del cliente. Traduce a `{ ok, error }`.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { cancelStoreOrder } from "@/lib/retail/orders";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function cancelStoreOrderAction(slug: string, campaignId: number, orderId: number, reason: string | null): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await cancelStoreOrder(orderId, userId, reason);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes/${orderId}`);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes`);
    return { ok: true };
  } catch (err) {
    if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
    throw err;
  }
}
