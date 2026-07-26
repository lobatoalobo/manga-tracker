/**
 * Infra de Retail — helper de autorización de acciones de campaña. Deriva la autorización de la política
 * CENTRAL (`CAMPAIGN_POLICY`) y la aplica con `authorizeStoreAccess` (session-free) por `storeId` ESTABLE.
 * El `storeId` SIEMPRE se deriva de la entidad real (campaña) antes de autorizar, nunca se confía en uno
 * enviado por el cliente. `actorUserId` es explícito (la capa de acciones lo obtiene de la sesión).
 */
import { authorizeStoreAccess, type StoreAuthContext } from "@/lib/storeAccess";
import { policyFor, type CampaignAction } from "@/lib/domain/retail/policy";
import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "storeCommerceProfile" | "storeMember">;

/** Autoriza `action` sobre `storeId` para `actorUserId` según la matriz de roles + requireEnabled. */
export function authorizeCampaignAction(
  client: Db,
  storeId: number,
  actorUserId: string | null,
  action: CampaignAction,
): Promise<StoreAuthContext> {
  const p = policyFor(action);
  return authorizeStoreAccess(client, { storeId }, actorUserId, { allowedRoles: p.roles, requireEnabled: p.requireEnabled });
}
