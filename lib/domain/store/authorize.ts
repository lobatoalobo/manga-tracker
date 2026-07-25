/**
 * Dominio de Retail — autorización de tienda comercial. PURO (sin Prisma, sin `auth()`).
 *
 * Aísla la ÚNICA lógica con valor de dominio de la Slice 1 —quién puede administrar una tienda— para
 * testearla sin base ni sesión. La infra (`lib/storeAuth.ts`) resuelve sesión + perfil/miembro y delega
 * acá. Toda operación comercial futura debe pasar por esta decisión (NUNCA `isAdmin`, que es global).
 *
 * Regla de acceso (en orden): autenticado → la tienda tiene perfil comercial → el usuario es miembro →
 * (si la operación lo exige) la tienda está habilitada → el rol del miembro está permitido.
 */

/** Roles de administración de una tienda. Los CLIENTES nunca son miembros. Sin permisos granulares aún. */
export const STORE_ROLE = { OWNER: "OWNER", STAFF: "STAFF" } as const;
export type StoreRole = (typeof STORE_ROLE)[keyof typeof STORE_ROLE];

/** ¿El string persistido es un rol válido? (defensivo ante datos inesperados). */
export function isStoreRole(v: string): v is StoreRole {
  return v === STORE_ROLE.OWNER || v === STORE_ROLE.STAFF;
}

/** Motivos de rechazo de autorización (códigos estables; la UI/acciones los traducen). */
export const STORE_AUTH_ERROR = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  STORE_DISABLED: "STORE_DISABLED",
  FORBIDDEN_ROLE: "FORBIDDEN_ROLE",
} as const;
export type StoreAuthErrorCode = (typeof STORE_AUTH_ERROR)[keyof typeof STORE_AUTH_ERROR];

/** Error de autorización de tienda, con un `code` estable para traducir a respuesta/HTTP. */
export class StoreAuthError extends Error {
  constructor(readonly code: StoreAuthErrorCode) {
    super(`store auth: ${code}`);
    this.name = "StoreAuthError";
  }
}

/** Vista mínima del perfil comercial que la decisión necesita. */
export interface AuthProfileView {
  readonly id: number;
  readonly enabled: boolean;
}
/** Vista mínima de la membresía que la decisión necesita. */
export interface AuthMemberView {
  readonly userId: string;
  readonly role: string;
}

export interface AuthorizeInput {
  /** Usuario autenticado (o null si no hay sesión). */
  readonly userId: string | null;
  /** Perfil comercial resuelto por slug (o null si la tienda no es comercial). */
  readonly profile: AuthProfileView | null;
  /** Membresía del usuario en ese perfil (o null si no es miembro). */
  readonly member: AuthMemberView | null;
  /** Roles aceptados por la operación (default: OWNER y STAFF). */
  readonly allowedRoles?: readonly StoreRole[];
  /** ¿La operación exige la tienda habilitada? (default false: p. ej. el admin puede reactivarla). */
  readonly requireEnabled?: boolean;
}

/** Contexto autorizado devuelto al aprobar. */
export interface AuthorizedStore {
  readonly userId: string;
  readonly profile: AuthProfileView;
  readonly member: AuthMemberView;
  readonly role: StoreRole;
}

/**
 * Decide el acceso a la administración comercial de una tienda o lanza `StoreAuthError`. PURA.
 * El orden de chequeo es normativo (autenticación → perfil → membresía → habilitación → rol): un no-miembro
 * de una tienda deshabilitada recibe `NOT_A_MEMBER` (no se filtra el estado de habilitación a extraños).
 */
export function authorizeStoreMember(input: AuthorizeInput): AuthorizedStore {
  const allowed = input.allowedRoles ?? [STORE_ROLE.OWNER, STORE_ROLE.STAFF];

  if (!input.userId) throw new StoreAuthError(STORE_AUTH_ERROR.UNAUTHENTICATED);
  if (!input.profile) throw new StoreAuthError(STORE_AUTH_ERROR.PROFILE_NOT_FOUND);
  if (!input.member || input.member.userId !== input.userId)
    throw new StoreAuthError(STORE_AUTH_ERROR.NOT_A_MEMBER);
  if (input.requireEnabled && !input.profile.enabled)
    throw new StoreAuthError(STORE_AUTH_ERROR.STORE_DISABLED);
  if (!isStoreRole(input.member.role) || !allowed.includes(input.member.role))
    throw new StoreAuthError(STORE_AUTH_ERROR.FORBIDDEN_ROLE);

  return { userId: input.userId, profile: input.profile, member: input.member, role: input.member.role };
}
