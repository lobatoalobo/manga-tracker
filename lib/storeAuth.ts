/**
 * Infra de Retail — adaptadores de autorización CON SESIÓN. Delgados sobre `authorizeStoreAccess`
 * (central, sin sesión, en `lib/storeAccess.ts`): agregan el `userId` de la sesión (`auth()`) y eligen la
 * llave estable. NUNCA usan `isAdmin` (eso es administración GLOBAL, no de tiendas).
 *  - por `slug`      → páginas (entrada de ruta web).
 *  - por `storeId`   → acciones que derivan la tienda desde una entidad histórica (no confían en el slug).
 *  - por `profileId` → acciones de config/miembros.
 */
import { auth } from "@/auth";
import {
  authorizeStoreAccess,
  storeAccessClient,
  type StoreLocator,
  type RequireStoreMemberOptions,
  type StoreAuthContext,
} from "@/lib/storeAccess";

export type { StoreAuthContext, RequireStoreMemberOptions, ProfileWithStore } from "@/lib/storeAccess";

/** userId de la sesión actual (o null). */
async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function withSession(locator: StoreLocator, opts?: RequireStoreMemberOptions): Promise<StoreAuthContext> {
  return authorizeStoreAccess(storeAccessClient, locator, await sessionUserId(), opts);
}

/** Adaptador de PÁGINA: autoriza por `slug` de ruta usando la sesión. */
export function requireStoreMember(slug: string, opts?: RequireStoreMemberOptions) {
  return withSession({ slug }, opts);
}
/** Adaptador de ACCIÓN: autoriza por `storeId` derivado de una entidad histórica (no confía en el slug). */
export function requireStoreMemberByStoreId(storeId: number, opts?: RequireStoreMemberOptions) {
  return withSession({ storeId }, opts);
}
/** Adaptador de ACCIÓN: autoriza por `profileId` (config/miembros). */
export function requireStoreMemberByProfileId(profileId: number, opts?: RequireStoreMemberOptions) {
  return withSession({ profileId }, opts);
}
