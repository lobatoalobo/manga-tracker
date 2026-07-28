"use server";

/**
 * Server action de RESERVA pública (Slice 3): adaptador delgado sesión → `createStoreOrder`. Obtiene el
 * `userId` de la sesión (confirmar exige autenticación) y NUNCA confía en storeId/precios del cliente: el
 * servicio deriva la tienda de la campaña y calcula los totales en el servidor. Devuelve el `publicCode`
 * para que el cliente redirija al detalle de su orden.
 */
import { requireUserId } from "@/auth";
import { createStoreOrder } from "@/lib/retail/orders";
import type { RequestedLine } from "@/lib/domain/retail/order";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ReserveResult = { ok: true; publicCode: string } | { ok: false; error: string };

/** Confirma una reserva. `items` = líneas elegidas (offerId + cantidad); `expectedTotalCents` solo se verifica. */
export async function reserveAction(campaignId: number, items: RequestedLine[], expectedTotalCents: number | null): Promise<ReserveResult> {
  try {
    const userId = await requireUserId();
    const order = await createStoreOrder({ campaignId, items, expectedTotalCents }, userId);
    return { ok: true, publicCode: order.publicCode };
  } catch (err) {
    if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
    throw err;
  }
}
