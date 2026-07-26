"use server";

/**
 * Server actions de las reservas del CLIENTE (Slice 3). El servicio verifica propiedad (`order.userId`);
 * el `publicCode` no autoriza por sí solo. Traducen errores de dominio a `{ ok, error }`.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { cancelCustomerOrder } from "@/lib/retail/orders";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function cancelMyOrderAction(publicCode: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await cancelCustomerOrder(publicCode, userId);
    revalidatePath(`/mis-compras/preventas/${publicCode}`);
    revalidatePath("/mis-compras/preventas");
    return { ok: true };
  } catch (err) {
    if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
    throw err;
  }
}
