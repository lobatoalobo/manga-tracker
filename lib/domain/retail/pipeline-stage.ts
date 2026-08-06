/**
 * Dominio de Retail — ETAPA VISIBLE de una preventa para la tienda (lenguaje cotidiano). PURA: sin Prisma, con
 * `now` INYECTADO. No agrega una columna nueva: DERIVA la etapa desde el `status` de la campaña (historia
 * explícita), su ventana temporal y los contadores físicos AGREGADOS de sus líneas (§3, §14). El status técnico
 * (DRAFT/PUBLISHED/CLOSED/CANCELLED) nunca se muestra; esta capa lo traduce.
 *
 * La progresión post-cierre es MONÓTONA y refleja el ciclo real: pedir al distribuidor → esperar llegada →
 * preparar pedidos → entregar → finalizar. Se deriva de las cantidades, no de un flag por campaña.
 */
import { CAMPAIGN_STATUS, type CampaignStatus } from "@/lib/domain/retail/campaign";

/** Umbral de "por cerrar": una preventa abierta cuyo cierre está dentro de esta ventana (o ya pasó). */
export const CLOSING_SOON_MS = 24 * 60 * 60 * 1000;

export type StoreStage =
  | "preparando"
  | "abierta"
  | "por_cerrar"
  | "pedido_distribuidor"
  | "esperando_llegada"
  | "preparando_pedidos"
  | "entregando"
  | "finalizada"
  | "cancelada";

/** Texto cotidiano de cada etapa (lo que ve la tienda). Único lugar donde vive la traducción. */
export const STORE_STAGE_LABEL: Record<StoreStage, string> = {
  preparando: "Preparando",
  abierta: "Abierta",
  por_cerrar: "Por cerrar",
  pedido_distribuidor: "Pedido al distribuidor",
  esperando_llegada: "Esperando llegada",
  preparando_pedidos: "Preparando pedidos",
  entregando: "Entregando",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

/** Contadores físicos AGREGADOS de las líneas no canceladas de una campaña (Σ sobre sus órdenes). */
export interface CampaignFulfillmentTotals {
  readonly quantity: number;   // Σ quantity (unidades comerciales)
  readonly ordered: number;    // Σ orderedQuantity
  readonly arrived: number;    // Σ arrivedQuantity
  readonly cancelled: number;  // Σ cancelledQuantity
  readonly prepared: number;   // Σ preparedQuantity
  readonly pickedUp: number;   // Σ pickedUpQuantity
}

export interface CampaignStageView {
  readonly status: CampaignStatus;
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
  readonly totals: CampaignFulfillmentTotals;
}

/**
 * Deriva la etapa visible. PURA, `now` inyectado. Para CLOSED usa los contadores: `fulfillable` = unidades a
 * cumplir (quantity − cancelled); la etapa es el primer eslabón del ciclo que todavía no se completó.
 */
export function deriveCampaignStage(v: CampaignStageView, now: Date): StoreStage {
  switch (v.status) {
    case CAMPAIGN_STATUS.CANCELLED:
      return "cancelada";
    case CAMPAIGN_STATUS.DRAFT:
      return "preparando";
    case CAMPAIGN_STATUS.PUBLISHED: {
      if (v.closesAt && now.getTime() >= v.closesAt.getTime() - CLOSING_SOON_MS) return "por_cerrar";
      return "abierta";
    }
    case CAMPAIGN_STATUS.CLOSED: {
      const t = v.totals;
      const fulfillable = t.quantity - t.cancelled;
      if (fulfillable <= 0) return "finalizada";
      if (t.ordered < fulfillable) return "pedido_distribuidor";
      if (t.arrived < fulfillable) return "esperando_llegada";
      if (t.prepared < t.arrived) return "preparando_pedidos";
      if (t.pickedUp < t.prepared) return "entregando";
      return "finalizada";
    }
    default:
      return "preparando";
  }
}

/** ¿La etapa cuenta como "activa" (abierta al cliente) para los indicadores? */
export function isOpenStage(stage: StoreStage): boolean {
  return stage === "abierta";
}

/** Mes calendario (año+mes) de una fecha en la zona del servidor; para "finalizadas / reservas de este mes". */
export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
