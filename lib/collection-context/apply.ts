/**
 * Collection (Slice 8) — persistencia e idempotencia transaccional del apply. Infra (Prisma), session-free.
 * Traduce los conflictos de base a `ProjectionResult` (nunca depende de mensajes de Prisma como contrato) y
 * NO importa Retail: recibe un `AcquisitionFact` ya construido por el proyector. Ver ADR-010 §D4/§D6.
 *
 * Algoritmo sin la trampa de `P2002`: en PostgreSQL una violación de unicidad ABORTA la transacción, así que
 * NO se usa `try create / catch P2002`. `createMany({ skipDuplicates: true })` compila a
 * `INSERT … ON CONFLICT DO NOTHING` y devuelve el count SIN abortar → se ramifica por count.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CollectionError, COLLECTION_ERROR } from "@/lib/domain/collection/errors";
import { reconcileAcquisition, type AcquisitionFact } from "@/lib/domain/collection/acquisition";
import { PROJECTION_RESULT, type ProjectionResult } from "@/lib/domain/collection/result";

type Client = PrismaClient;

/** Los cinco atributos de dominio del hecho persistido, para reconciliar un intento perdedor. */
const RECONCILE_SELECT = { userId: true, volumeId: true, quantity: true, channel: true, occurredAt: true } as const;

/**
 * Aplica un hecho DENTRO de una transacción dada (NO abre la suya). Devuelve `APPLIED` | `ALREADY_APPLIED`;
 * lanza `CollectionError(ACQUISITION_KEY_CONFLICT)` si la clave existe con otro payload (para ABORTAR la tx).
 * Insert de `Acquisition` e incremento de `OwnershipPosition` ocurren en ESTA misma tx (atómicos).
 */
export async function applyAcquisitionTx(tx: Prisma.TransactionClient, fact: AcquisitionFact): Promise<ProjectionResult> {
  const { acquisitionKey, userId, volumeId, quantity, channel, occurredAt } = fact;

  // (1) Creación idempotente del hecho (ON CONFLICT DO NOTHING). count === 1 → ganamos; 0 → ya existe / perdimos.
  const inserted = await tx.acquisition.createMany({
    data: [{ acquisitionKey, userId, volumeId, quantity, channel, occurredAt }],
    skipDuplicates: true,
  });

  if (inserted.count === 0) {
    // Perdió la carrera de unicidad (o ya estaba aplicado): reconciliar los cinco atributos, SIN incrementar.
    const existing = await tx.acquisition.findUnique({ where: { acquisitionKey }, select: RECONCILE_SELECT });
    reconcileAcquisition(existing, fact); // igual → true (no-op); distinto → ACQUISITION_KEY_CONFLICT
    return PROJECTION_RESULT.ALREADY_APPLIED;
  }

  // (2) Ganamos el insert: asegurar la posición en 0 (idempotente, evita el race del upsert-create) e
  // incrementar de forma ATÓMICA bajo el lock de fila. Todo en esta tx: si algo falla, se revierte también (1).
  await tx.ownershipPosition.createMany({ data: [{ userId, volumeId, quantity: 0 }], skipDuplicates: true });
  await tx.ownershipPosition.update({
    where: { userId_volumeId: { userId, volumeId } },
    data: { quantity: { increment: quantity } },
  });
  return PROJECTION_RESULT.APPLIED;
}

/**
 * Capa exterior: ejecuta el apply en UNA `$transaction` y traduce FUERA de ella los resultados esperables.
 * Nunca continúa una tx abortada: el conflicto de payload y las violaciones de FK abortan y se traducen acá.
 *  - `ACQUISITION_KEY_CONFLICT` → `CONFLICT`.
 *  - `P2003` (FK) → `TERMINALLY_NOT_APPLICABLE`: el destino (cuenta) desapareció en carrera. El volumen siempre
 *    existe (Restrict), así que el único FK alcanzable acá es el del usuario (Cascade) → terminal, no reintentar.
 *  - cualquier otro error → `RETRYABLE_FAILURE`: transitorio/inesperado, lo recupera el barrido.
 */
export async function applyAcquisition(fact: AcquisitionFact, client: Client = prisma): Promise<ProjectionResult> {
  try {
    return await client.$transaction((tx) => applyAcquisitionTx(tx, fact));
  } catch (err) {
    if (err instanceof CollectionError && err.code === COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT) return PROJECTION_RESULT.CONFLICT;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return PROJECTION_RESULT.TERMINALLY_NOT_APPLICABLE;
    return PROJECTION_RESULT.RETRYABLE_FAILURE;
  }
}
