/**
 * Infra: RESOLUCIÓN de lectura de un handle de Identity (separada de la ejecución de Fusionar, §16). Dado
 * un handle, devuelve la identidad TERMINAL activa hacia la que resuelve. v1 admite UN SOLO salto de
 * redirección (no compacta cadenas). NO modifica datos. Fusionar NUNCA usa esta resolución para
 * reemplazar los handles de la Decisión (el Registro no substituye un handle por su terminal).
 *
 * Casos:
 * - handle ACTIVE                → resuelve a sí mismo (terminal).
 * - handle REDIRECTED (un salto) → resuelve al destino, que debe ser ACTIVE (terminal).
 * - handle inexistente           → NOT_FOUND.
 * - destino inexistente/roto     → BROKEN (redirección colgada).
 * - autorredirección             → BROKEN (no debería ocurrir; CHECK lo impide).
 * - cadena (destino REDIRECTED)   → CHAIN (v1 no la soporta; señala invariante violado o dato legado).
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const IDENTITY_STATE_ACTIVE = "ACTIVE" as const;
const IDENTITY_STATE_REDIRECTED = "REDIRECTED" as const;

export type ResolveClient = Pick<PrismaClient, "catalogIdentity">;

/** Resultado de resolver un handle (lectura). `terminalHandle` es el destino activo (si `kind==='ACTIVE'`). */
export type ResolveResult =
  | { readonly kind: "ACTIVE"; readonly requestedHandle: number; readonly terminalHandle: number; readonly redirected: boolean }
  | { readonly kind: "NOT_FOUND"; readonly requestedHandle: number }
  | { readonly kind: "BROKEN"; readonly requestedHandle: number; readonly reason: "MISSING_TARGET" | "SELF_REDIRECT" }
  | { readonly kind: "CHAIN"; readonly requestedHandle: number; readonly nextHandle: number };

const SELECT = { id: true, state: true, redirectsToId: true } as const;

/** Resuelve `handle` a su identidad terminal activa (un salto). Lectura pura, sin mutación. */
export async function resolveIdentity(client: ResolveClient, handle: number): Promise<ResolveResult> {
  const row = await client.catalogIdentity.findUnique({ where: { id: handle }, select: SELECT });
  if (!row) return { kind: "NOT_FOUND", requestedHandle: handle };

  if (row.state === IDENTITY_STATE_ACTIVE && row.redirectsToId === null)
    return { kind: "ACTIVE", requestedHandle: handle, terminalHandle: handle, redirected: false };

  if (row.state === IDENTITY_STATE_REDIRECTED && row.redirectsToId !== null) {
    if (row.redirectsToId === handle) return { kind: "BROKEN", requestedHandle: handle, reason: "SELF_REDIRECT" };
    const target = await client.catalogIdentity.findUnique({ where: { id: row.redirectsToId }, select: SELECT });
    if (!target) return { kind: "BROKEN", requestedHandle: handle, reason: "MISSING_TARGET" };
    if (target.state === IDENTITY_STATE_ACTIVE && target.redirectsToId === null)
      return { kind: "ACTIVE", requestedHandle: handle, terminalHandle: target.id, redirected: true };
    // El destino no es terminal → cadena (v1 no la soporta).
    return { kind: "CHAIN", requestedHandle: handle, nextHandle: target.id };
  }

  // Estado incoherente (no debería ocurrir: los CHECK de la migración lo impiden).
  return { kind: "BROKEN", requestedHandle: handle, reason: "MISSING_TARGET" };
}

/** Resolutor de producción (Prisma global). */
export function prismaResolveIdentity(handle: number): Promise<ResolveResult> {
  return resolveIdentity(prisma, handle);
}
