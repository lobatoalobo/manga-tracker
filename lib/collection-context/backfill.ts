/**
 * F2.2 — Executor de backfill del legado `OwnedVolume` → Collection (ADR-012). Establece PRESENCIA en Collection
 * únicamente para los casos RESOLVABLE (destino determinístico único), reutilizando el vocabulario de dominio de
 * Slice 8 (`Acquisition`/`OwnershipPosition`) SIN reimplementar su semántica de pickup.
 *
 * Diferencia clave con `applyAcquisition` (Slice 8): ese incrementa `OwnershipPosition.quantity`; el backfill
 * NO incrementa. Solo crea la posición cuando NO existe; si ya existe (de cualquier fuente, incluida
 * `quantity = 0`, que Collection considera autoritativa — ADR-011), la respeta y no la toca.
 *
 * Atomicidad: el árbitro es el índice único `OwnershipPosition(userId, volumeId)`. `createMany(skipDuplicates)`
 * compila a `INSERT … ON CONFLICT DO NOTHING`; el `count` decide, atómicamente, si esta corrida creó la posición.
 * Los conflictos se LANZAN dentro del callback de `$transaction` para ABORTAR (la posición provisional no persiste)
 * y se traducen a un resultado FUERA de la transacción. No se importa Retail. No toca catálogo ni el legado.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CollectionError, COLLECTION_ERROR } from "@/lib/domain/collection/errors";
import {
  ACQUISITION_CHANNEL,
  assertValidAcquisition,
  reconcileAcquisition,
  type AcquisitionFact,
} from "@/lib/domain/collection/acquisition";

/**
 * Sentinela fija de `occurredAt` para hechos de backfill. Representa **tiempo físico DESCONOCIDO** de una
 * importación legada (el modelo `OwnedVolume` no guarda cuándo se adquirió): NO es una fecha real de adquisición.
 * Debe ser estable/determinística para que la reconciliación idempotente sea no-op en re-runs.
 */
export const LEGACY_BACKFILL_OCCURRED_AT = new Date("1970-01-01T00:00:00.000Z");

/** Cantidad fija: el legado es booleano (poseído) → 1 unidad. Cumple el CHECK `Acquisition.quantity > 0`. */
export const LEGACY_BACKFILL_QUANTITY = 1;

/** Clave idempotente estable por `(userId, volumeId)`, con procedencia explícita de backfill legado. */
export function legacyBackfillAcquisitionKey(userId: string, volumeId: number): string {
  return `legacy-backfill:${userId}:${volumeId}`;
}

/** Construye el `AcquisitionFact` determinístico de backfill para un caso RESOLVABLE. */
export function buildLegacyBackfillFact(userId: string, volumeId: number): AcquisitionFact {
  return {
    acquisitionKey: legacyBackfillAcquisitionKey(userId, volumeId),
    userId,
    volumeId,
    quantity: LEGACY_BACKFILL_QUANTITY,
    channel: ACQUISITION_CHANNEL.LEGACY_BACKFILL,
    occurredAt: LEGACY_BACKFILL_OCCURRED_AT,
  };
}

/**
 * Resultados posibles de establecer presencia legada:
 *  - APPLIED         — esta corrida creó la posición y registró la `Acquisition` de backfill.
 *  - ALREADY_APPLIED — ya existía nuestra `Acquisition` de backfill (mismo payload): re-run idempotente, no-op.
 *  - ALREADY_PRESENT — existe una `OwnershipPosition` (incl. `quantity = 0`) SIN nuestra `Acquisition`: posesión
 *                      de otra fuente. Se respeta; no se incrementa ni se escribe.
 *  - CONFLICT        — conflicto de dominio explícito (payload incompatible reusando la clave, o `Acquisition` de
 *                      backfill existente sin su posición esperada). La tx aborta; nada se persiste.
 *  - TERMINAL        — una referencia requerida desapareció durante la ejecución (FK, `P2003`): no aplica, no se reintenta.
 *  - RETRYABLE       — fallo transitorio de infraestructura de una lista blanca explícita: lo recupera el re-run.
 */
export const BACKFILL_RESULT = {
  APPLIED: "APPLIED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  ALREADY_PRESENT: "ALREADY_PRESENT",
  CONFLICT: "CONFLICT",
  TERMINAL: "TERMINAL",
  RETRYABLE: "RETRYABLE",
} as const;
export type BackfillResult = (typeof BACKFILL_RESULT)[keyof typeof BACKFILL_RESULT];

/** Inconsistencia: existe la `Acquisition` de backfill pero NO su `OwnershipPosition` esperada. Nunca se corrige en silencio. */
export class BackfillInconsistencyError extends Error {
  constructor(readonly acquisitionKey: string) {
    super("backfill: Acquisition existe sin su OwnershipPosition esperada");
    this.name = "BackfillInconsistencyError";
  }
}

/** Códigos Prisma transitorios de la LISTA BLANCA reintentable. Todo lo demás desconocido → aborta (no se disimula). */
const RETRYABLE_PRISMA_CODES: ReadonlySet<string> = new Set([
  "P2034", // write conflict / deadlock: reintentable
  "P1001", // no se pudo alcanzar la base
  "P1002", // timeout de conexión
  "P1008", // timeout de operación
  "P1017", // conexión cerrada por el servidor
]);

/** Payload de dominio para reconciliar una `Acquisition` existente. `recordedAt`/`id` quedan fuera del contrato. */
const PAYLOAD_SELECT = { userId: true, volumeId: true, quantity: true, channel: true, occurredAt: true } as const;

/**
 * Establece presencia DENTRO de una transacción dada. Devuelve `APPLIED | ALREADY_APPLIED | ALREADY_PRESENT`;
 * LANZA (para abortar la tx y revertir la posición provisional) ante conflicto de dominio.
 */
export async function establishLegacyPresenceTx(
  tx: Prisma.TransactionClient,
  fact: AcquisitionFact,
): Promise<BackfillResult> {
  assertValidAcquisition(fact);
  const { acquisitionKey, userId, volumeId, quantity, channel, occurredAt } = fact;

  // Árbitro atómico: crear la posición SOLO si no existe. count===1 → la creamos; count===0 → ya existía.
  const createdPos = await tx.ownershipPosition.createMany({
    data: [{ userId, volumeId, quantity }],
    skipDuplicates: true,
  });

  if (createdPos.count === 0) {
    // La posición ya existe (cualquier fuente/quantity, incl. 0): NO se toca. Distinguir por nuestra Acquisition.
    const existing = await tx.acquisition.findUnique({ where: { acquisitionKey }, select: PAYLOAD_SELECT });
    // reconcile: existente + mismo payload → true (ya aplicado); existente + distinto → lanza CONFLICT; null → false.
    if (reconcileAcquisition(existing, fact)) return BACKFILL_RESULT.ALREADY_APPLIED;
    return BACKFILL_RESULT.ALREADY_PRESENT; // posición de otra fuente, sin nuestra Acquisition
  }

  // Creamos la posición (estaba ausente): registrar nuestra Acquisition de procedencia.
  const insertedAcq = await tx.acquisition.createMany({
    data: [{ acquisitionKey, userId, volumeId, quantity, channel, occurredAt }],
    skipDuplicates: true,
  });

  if (insertedAcq.count === 0) {
    // La clave ya existía pero la posición estaba ausente = inconsistencia. Reconciliar y, aun con mismo payload,
    // lanzar conflicto explícito (aborta la tx → revierte la posición recién creada; nunca corrige en silencio).
    const existing = await tx.acquisition.findUnique({ where: { acquisitionKey }, select: PAYLOAD_SELECT });
    reconcileAcquisition(existing, fact); // payload distinto → ACQUISITION_KEY_CONFLICT
    throw new BackfillInconsistencyError(acquisitionKey);
  }

  return BACKFILL_RESULT.APPLIED;
}

/**
 * Capa exterior: ejecuta la primitiva en UNA `$transaction` y traduce los conflictos FUERA de la transacción
 * (nunca confirma una posición provisional). Clasificación EXPLÍCITA de errores; sin catch-all reintentable:
 *  - `ACQUISITION_KEY_CONFLICT` / `BackfillInconsistencyError` → `CONFLICT` (no se reintenta).
 *  - `P2003` (FK: una referencia requerida —User/Volume— desapareció) → `TERMINAL`.
 *  - códigos Prisma de la lista blanca → `RETRYABLE`.
 *  - cualquier otro error → se RELANZA (aborta la corrida): jamás se disimula como transitorio.
 */
export async function establishLegacyPresence(
  fact: AcquisitionFact,
  client: PrismaClient = prisma,
): Promise<BackfillResult> {
  try {
    return await client.$transaction((tx) => establishLegacyPresenceTx(tx, fact));
  } catch (err) {
    if (err instanceof CollectionError && err.code === COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT) {
      return BACKFILL_RESULT.CONFLICT;
    }
    if (err instanceof BackfillInconsistencyError) return BACKFILL_RESULT.CONFLICT;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") return BACKFILL_RESULT.TERMINAL; // FK: no afirmamos CUÁL sin certeza de Prisma
      if (RETRYABLE_PRISMA_CODES.has(err.code)) return BACKFILL_RESULT.RETRYABLE;
    }
    throw err; // desconocido → aborta la corrida (fail-fast, sin enmascarar)
  }
}
