"use server";

/**
 * Server actions de preparación y retiro (Slice 7) para la TIENDA. El servicio deriva la tienda/orden desde la
 * propia entidad (no confía en slug/ids del cliente). Las claves de idempotencia las genera el cliente por
 * intento lógico: `operationKey` en las individuales, `batchOperationKey` en las masivas (con payload de items
 * EXPLÍCITO e inmutable, construido una sola vez desde el snapshot visible). Traducen a `{ ok, error }`.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { prepareOrderLine, pickupOrderLine, prepareOrderLines, pickupOrderLines, type HandoffBatchItem } from "@/lib/retail/handoff";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(err: unknown): ActionResult {
  if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
  throw err;
}
const revalidate = (slug: string, campaignId: number, orderId: number) => {
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes/${orderId}`);
  revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/preparacion`);
};

export async function prepareLineAction(slug: string, campaignId: number, orderId: number, lineId: number, quantity: number, operationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await prepareOrderLine(lineId, quantity, userId, operationKey);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function pickupLineAction(slug: string, campaignId: number, orderId: number, lineId: number, quantity: number, operationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await pickupOrderLine(lineId, quantity, userId, operationKey);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function prepareBatchAction(slug: string, campaignId: number, orderId: number, items: HandoffBatchItem[], batchOperationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await prepareOrderLines(orderId, items, userId, batchOperationKey);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function pickupBatchAction(slug: string, campaignId: number, orderId: number, items: HandoffBatchItem[], batchOperationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await pickupOrderLines(orderId, items, userId, batchOperationKey);
    revalidate(slug, campaignId, orderId);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
