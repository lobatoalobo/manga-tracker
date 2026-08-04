"use server";

/**
 * Server action de configuración comercial de la tienda (Slice P0). Edita los datos de contacto/pago del perfil.
 * AUTORIZACIÓN dentro de la action (una server function es alcanzable por POST directo): OWNER-only, porque el
 * alias de pago es sensible; `requireEnabled: false` para poder editar aun con el comercio deshabilitado.
 * No toca `enabled`, `slug` ni `checkoutMode` (este último no es editable en P0: valor único CONVERSATIONAL).
 */
import { revalidatePath } from "next/cache";
import { requireStoreMember } from "@/lib/storeAuth";
import { updateCommerceData, type CommerceDataInput } from "@/lib/storeCommerce";
import { STORE_ROLE, StoreAuthError } from "@/lib/domain/store/authorize";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateCommerceDataAction(slug: string, data: CommerceDataInput): Promise<ActionResult> {
  try {
    await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER], requireEnabled: false });
    await updateCommerceData(slug, data);
    revalidatePath(`/tiendas/${slug}/admin`);
    return { ok: true };
  } catch (err) {
    if (err instanceof StoreAuthError) return { ok: false, error: err.code };
    throw err;
  }
}
