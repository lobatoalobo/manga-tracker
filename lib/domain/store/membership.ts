/**
 * Dominio de Retail — invariantes de membresía y política de bootstrap. PURO (sin Prisma).
 *
 * Invariante central: **un StoreCommerceProfile SIEMPRE tiene ≥1 OWNER**. La infra
 * (`lib/storeCommerce.ts`) aplica estas decisiones bajo transacción + lock de las filas OWNER para que
 * dos operaciones concurrentes no puedan dejar la tienda sin OWNER.
 */
import { STORE_ROLE, type StoreRole } from "@/lib/domain/store/authorize";

export const STORE_MEMBERSHIP_ERROR = {
  /** La operación dejaría al perfil sin ningún OWNER (borrar/degradar al último). */
  LAST_OWNER: "LAST_OWNER",
  /** Solo un administrador GLOBAL puede hacer el bootstrap inicial de una tienda comercial. */
  BOOTSTRAP_FORBIDDEN: "BOOTSTRAP_FORBIDDEN",
} as const;
export type StoreMembershipErrorCode = (typeof STORE_MEMBERSHIP_ERROR)[keyof typeof STORE_MEMBERSHIP_ERROR];

export class StoreMembershipError extends Error {
  constructor(readonly code: StoreMembershipErrorCode) {
    super(`store membership: ${code}`);
    this.name = "StoreMembershipError";
  }
}

/** Operación sobre el rol de un usuario: pasar a OWNER, a STAFF, o quitarlo del padrón. */
export type OwnerOp = { readonly userId: string; readonly next: StoreRole | "REMOVE" };

/**
 * Conjunto de OWNERs resultante de aplicar `op` sobre el padrón actual de OWNERs. Promover a OWNER agrega;
 * degradar a STAFF o quitar, remueve. Idempotente por construcción (Set).
 */
export function resultingOwnerUserIds(currentOwnerUserIds: readonly string[], op: OwnerOp): string[] {
  const set = new Set(currentOwnerUserIds);
  if (op.next === STORE_ROLE.OWNER) set.add(op.userId);
  else set.delete(op.userId); // STAFF (degradación) o REMOVE
  return [...set];
}

/** ¿La operación dejaría al perfil sin ningún OWNER? */
export function wouldLeaveNoOwner(currentOwnerUserIds: readonly string[], op: OwnerOp): boolean {
  return resultingOwnerUserIds(currentOwnerUserIds, op).length === 0;
}

/** Lanza `LAST_OWNER` si la operación dejaría al perfil sin OWNER. Se llama BAJO LOCK del padrón OWNER. */
export function assertKeepsOwner(currentOwnerUserIds: readonly string[], op: OwnerOp): void {
  if (wouldLeaveNoOwner(currentOwnerUserIds, op)) throw new StoreMembershipError(STORE_MEMBERSHIP_ERROR.LAST_OWNER);
}

/**
 * Política de bootstrap (§4): SOLO un administrador global puede crear el perfil comercial + asignar el
 * OWNER inicial + habilitar por primera vez. Después del bootstrap, la administración es por StoreMember
 * (nunca `isAdmin`). El caller (acción/seed) calcula `isGlobalAdmin` (p. ej. con `isAdmin(email)`).
 */
export function assertBootstrapAllowed(isGlobalAdmin: boolean): void {
  if (!isGlobalAdmin) throw new StoreMembershipError(STORE_MEMBERSHIP_ERROR.BOOTSTRAP_FORBIDDEN);
}
