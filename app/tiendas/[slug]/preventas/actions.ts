"use server";

/**
 * Server actions del módulo Preventas (shell SaaS). Adaptador delgado sesión → servicio de dominio: reutiliza
 * el servicio REAL `createPreorderCampaign` (mismo que el flujo admin) y revalida la Home SaaS. No hay lógica
 * de negocio nueva acá; los servicios autorizan por `storeId` derivado del slug (nunca confían en el cliente).
 */
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/auth";
import { getCommerceProfileBySlug } from "@/lib/storeCommerce";
import { createPreorderCampaign } from "@/lib/retail/campaigns";
import { RetailError } from "@/lib/domain/retail/errors";
import { StoreAuthError } from "@/lib/domain/store/authorize";

export interface NewCampaignInput {
  title: string;
  description: string;
  opensAt: string | null; // datetime-local ("YYYY-MM-DDTHH:mm") o null
  closesAt: string | null;
}

export type CreateCampaignResult = { ok: true; id: number } | { ok: false; error: string };

const dateOrNull = (v: string | null): Date | null => {
  const t = (v ?? "").trim();
  return t ? new Date(t) : null;
};

/**
 * Crea una campaña en DRAFT con los campos que hoy persisten (nombre, apertura, cierre, descripción). El
 * período de gracia y el canal de comunicación TODAVÍA no tienen columna: no se inventan hardcodes; se suman
 * con una migración aditiva en una fase posterior (ver NuevaPreventaScreen).
 */
export async function createStoreCampaignAction(slug: string, input: NewCampaignInput): Promise<CreateCampaignResult> {
  try {
    const userId = await requireUserId();
    const profile = await getCommerceProfileBySlug(slug);
    if (!profile) return { ok: false, error: "PROFILE_NOT_FOUND" };
    const c = await createPreorderCampaign(
      {
        storeId: profile.storeId,
        title: input.title,
        description: input.description,
        opensAt: dateOrNull(input.opensAt),
        closesAt: dateOrNull(input.closesAt),
      },
      userId,
    );
    revalidatePath(`/tiendas/${slug}/preventas`);
    return { ok: true, id: c.id };
  } catch (err) {
    if (err instanceof RetailError || err instanceof StoreAuthError) return { ok: false, error: err.code };
    throw err; // errores no de dominio → error boundary
  }
}
