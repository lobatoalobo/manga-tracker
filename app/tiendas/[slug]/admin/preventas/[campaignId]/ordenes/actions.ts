"use server";

/**
 * Server actions de la TIENDA sobre una orden (Slice 3 cancelación + Slice 4 cumplimiento). El servicio
 * deriva el `storeId` de la propia entidad (orden/línea) y autoriza al miembro (OWNER/STAFF); no confía en el
 * slug/ids del cliente. El `operationKey` (idempotencia) lo genera el cliente por submit. Traduce a `{ ok, error }`.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { cancelStoreOrder } from "@/lib/retail/orders";
import { markOrderLineOrdered, markOrderLineArrived, cancelOrderLineQuantity } from "@/lib/retail/fulfillment";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(err: unknown): ActionResult {
  if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
  throw err;
}

export async function cancelStoreOrderAction(slug: string, campaignId: number, orderId: number, reason: string | null): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await cancelStoreOrder(orderId, userId, reason);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes/${orderId}`);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

const revalidateOrder = (slug: string, campaignId: number, orderId: number) => {
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes/${orderId}`);
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/cumplimiento`);
};

/** Marca `quantity` unidades de una línea como pedidas al proveedor. */
export async function markLineOrderedAction(slug: string, campaignId: number, orderId: number, lineId: number, quantity: number, operationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await markOrderLineOrdered(lineId, quantity, userId, operationKey);
    revalidateOrder(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

/** Registra `quantity` unidades llegadas de una línea (parcial o directa). */
export async function markLineArrivedAction(slug: string, campaignId: number, orderId: number, lineId: number, quantity: number, operationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await markOrderLineArrived(lineId, quantity, userId, operationKey);
    revalidateOrder(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

/** Cancela `quantity` unidades PENDIENTES de una línea. */
export async function cancelLineQuantityAction(slug: string, campaignId: number, orderId: number, lineId: number, quantity: number, reason: string | null, operationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await cancelOrderLineQuantity(lineId, quantity, reason, userId, operationKey);
    revalidateOrder(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
