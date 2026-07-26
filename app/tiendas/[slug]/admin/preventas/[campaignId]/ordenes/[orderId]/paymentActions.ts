"use server";

/**
 * Server actions de pagos manuales (Slice 6) para la TIENDA. El servicio deriva la tienda/orden desde la
 * propia orden (no confía en slug/ids del cliente). `recordOperationKey` (idempotencia del registro) la genera
 * el cliente por intento lógico. El monto llega en pesos (string del form) y se convierte a centavos enteros
 * en el server. Traducen a `{ ok, error }`; nunca exponen Prisma.
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { registerPayment } from "@/lib/retail/payments";
import { pesosToCents } from "@/lib/retail/format";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(err: unknown): ActionResult {
  if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
  throw err;
}

export interface RegisterPaymentFields {
  amountPesos: string;
  method: string;
  paidAt: string; // yyyy-mm-dd (estable por intento)
  note?: string | null;
}

export async function registerPaymentAction(slug: string, campaignId: number, orderId: number, fields: RegisterPaymentFields, recordOperationKey: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const amountCents = pesosToCents(fields.amountPesos);
    if (amountCents == null) return { ok: false, error: RETAIL_ERROR.INVALID_PAYMENT_AMOUNT };
    const paidAt = fields.paidAt ? new Date(fields.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) return { ok: false, error: RETAIL_ERROR.INVALID_PAYMENT_AMOUNT };
    await registerPayment({ orderId, amountCents, method: fields.method, paidAt, note: fields.note ?? null }, userId, recordOperationKey);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/ordenes/${orderId}`);
    revalidatePath(`/tiendas/${slug}/admin/preventas/${campaignId}/pagos`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
