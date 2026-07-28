/**
 * Infra de Retail — autorización CENTRAL de tienda comercial, por llave ESTABLE y con `userId` EXPLÍCITO.
 *
 * Deliberadamente SIN dependencia de la sesión (`auth()`) ni de Next: (1) es testeable sin mocks de
 * sesión; (2) es invocable derivando la tienda desde una entidad histórica (futuras acciones reciben
 * campaignId/orderId, resuelven su storeId y NO confían en un slug del cliente). Los adaptadores que
 * agregan la sesión viven en `lib/storeAuth.ts`. La DECISIÓN es pura (`authorizeStoreMember`).
 */
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import {
  authorizeStoreMember,
  type StoreRole,
  type AuthorizedStore,
} from "@/lib/domain/store/authorize";

/** Llave ESTABLE para resolver una tienda comercial. El slug es solo la entrada de rutas web. */
export type StoreLocator = { slug: string } | { storeId: number } | { profileId: number };

type Db = Pick<PrismaClient, "storeCommerceProfile" | "storeMember">;

function loadProfile(client: Db, loc: StoreLocator) {
  const where =
    "slug" in loc ? { slug: loc.slug } : "storeId" in loc ? { storeId: loc.storeId } : { id: loc.profileId };
  return client.storeCommerceProfile.findUnique({ where, include: { store: true } });
}

export type ProfileWithStore = NonNullable<Awaited<ReturnType<typeof loadProfile>>>;

/** Contexto autorizado: la decisión pura + las filas ya cargadas (para no re-consultar). */
export interface StoreAuthContext extends AuthorizedStore {
  readonly profileRow: ProfileWithStore;
  readonly memberRow: { id: number; profileId: number; userId: string; role: string };
}

export interface RequireStoreMemberOptions {
  /** Roles aceptados (default: OWNER + STAFF). */
  allowedRoles?: readonly StoreRole[];
  /** Exigir la tienda habilitada (default false: el admin puede entrar a reactivarla). */
  requireEnabled?: boolean;
}

/**
 * Autorización central por llave estable, con `userId` explícito. Lanza `StoreAuthError` si no corresponde.
 */
export async function authorizeStoreAccess(
  client: Db,
  locator: StoreLocator,
  userId: string | null,
  opts: RequireStoreMemberOptions = {},
): Promise<StoreAuthContext> {
  const profileRow = await loadProfile(client, locator);
  const memberRow =
    profileRow && userId
      ? await client.storeMember.findUnique({
          where: { profileId_userId: { profileId: profileRow.id, userId } },
          select: { id: true, profileId: true, userId: true, role: true },
        })
      : null;

  const authorized = authorizeStoreMember({
    userId,
    profile: profileRow ? { id: profileRow.id, enabled: profileRow.enabled } : null,
    member: memberRow ? { userId: memberRow.userId, role: memberRow.role } : null,
    allowedRoles: opts.allowedRoles,
    requireEnabled: opts.requireEnabled,
  });

  // `authorized` garantiza que profileRow/memberRow no son null (si no, habría lanzado).
  return { ...authorized, profileRow: profileRow!, memberRow: memberRow! };
}

/** Cliente de producción para los adaptadores de sesión. */
export const storeAccessClient = prisma;
