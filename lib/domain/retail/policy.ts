/**
 * Dominio de Retail — política CENTRAL de autorización de acciones de campaña (§11, congelada). PURO.
 * NO dispersar esta matriz en la UI ni en los servicios: cada operación consulta acá qué roles la pueden
 * ejecutar y si exige la tienda habilitada.
 *
 * Matriz (MVP):
 *  - PUBLICAR / CANCELAR: solo OWNER.
 *  - CREAR / EDITAR BORRADOR / GESTIONAR OFERTAS: OWNER y STAFF (preparación).
 *  - CERRAR: OWNER y STAFF.
 *  - ELIMINAR BORRADOR: solo OWNER.
 *
 * `requireEnabled`: las operaciones de PREPARACIÓN y PUBLICACIÓN exigen la tienda habilitada; CERRAR /
 * CANCELAR / ELIMINAR BORRADOR se permiten aun deshabilitada (wind-down / limpieza).
 */
import { STORE_ROLE, type StoreRole } from "@/lib/domain/store/authorize";

export const CAMPAIGN_ACTION = {
  CREATE: "CREATE",
  EDIT_DRAFT: "EDIT_DRAFT",
  MANAGE_OFFERS: "MANAGE_OFFERS",
  PUBLISH: "PUBLISH",
  CLOSE: "CLOSE",
  CANCEL: "CANCEL",
  DELETE_DRAFT: "DELETE_DRAFT",
} as const;
export type CampaignAction = (typeof CAMPAIGN_ACTION)[keyof typeof CAMPAIGN_ACTION];

export interface ActionPolicy {
  readonly roles: readonly StoreRole[];
  readonly requireEnabled: boolean;
}

const O = STORE_ROLE.OWNER;
const S = STORE_ROLE.STAFF;

export const CAMPAIGN_POLICY: Record<CampaignAction, ActionPolicy> = {
  CREATE: { roles: [O, S], requireEnabled: true }, // crear el borrador es preparación (OWNER y STAFF)
  EDIT_DRAFT: { roles: [O, S], requireEnabled: true },
  MANAGE_OFFERS: { roles: [O, S], requireEnabled: true },
  PUBLISH: { roles: [O], requireEnabled: true },
  CLOSE: { roles: [O, S], requireEnabled: false },
  CANCEL: { roles: [O], requireEnabled: false },
  DELETE_DRAFT: { roles: [O], requireEnabled: false },
};

/** Opciones de autorización (roles + requireEnabled) para una acción, listas para `authorizeStoreAccess`. */
export function policyFor(action: CampaignAction): ActionPolicy {
  return CAMPAIGN_POLICY[action];
}
