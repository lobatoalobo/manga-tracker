/**
 * Collection (Slice 8) — proyección de un evento `PICKED_UP` a una `Acquisition`. Es la ÚNICA capa que lee un
 * hecho publicado de Retail (el ledger) y escribe Collection; ni el dominio de Retail ni el de Collection se
 * importan entre sí. Este módulo NO implementa el barrido, el cron, el advisory lock ni la integración
 * post-commit (Pasos 6-8): sólo clasifica, traduce, arma y aplica un evento ya cargado. Ver ADR-010 §D3/§D5.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACQUISITION_CHANNEL, type AcquisitionFact } from "@/lib/domain/collection/acquisition";
import { PROJECTION_RESULT, type ProjectionResult } from "@/lib/domain/collection/result";
import { applyAcquisition } from "@/lib/collection-context/apply";

type Client = PrismaClient;

/** Prefijo del namespace de la clave pública/opaca. ÚNICO punto de verdad: el helper y el SQL lo comparten. */
const ACQUISITION_KEY_PREFIX = "retail-pickup:";

/** Traducción DETERMINISTA de la identidad interna del pickup (`operationKey`) a la `acquisitionKey` pública. */
export function acquisitionKeyFor(operationKey: string): string {
  return `${ACQUISITION_KEY_PREFIX}${operationKey}`;
}

/** Evento `PICKED_UP` ya cargado (evento + `volumeId` de su línea). El proyector NO lo descubre: se lo pasan. */
export interface PickupEvent {
  readonly eventId: number;
  readonly operationKey: string;
  readonly quantity: number;
  readonly createdAt: Date;
  readonly ownerUserIdSnapshot: string | null;
  readonly volumeId: number;
}

/**
 * Proyecta UN evento `PICKED_UP` ya cargado (no abre lógica de barrido). Clasifica y aplica:
 *  1. `ownerUserIdSnapshot === null` → `CORRUPT_SOURCE` (no aplica; auditable con `findCorruptPickups`);
 *  2. snapshot presente + destino inexistente → `TERMINALLY_NOT_APPLICABLE` (auditable con `findTerminalPickups`);
 *  3. traduce `acquisitionKey`, arma el `AcquisitionFact` (channel `RETAIL_PICKUP`, `occurredAt = createdAt`) y
 *     lo aplica. La carrera de borrado POSTERIOR al chequeo la cubre `applyAcquisition` (P2003 → terminal).
 */
export async function projectPickupEvent(client: Client, ev: PickupEvent): Promise<ProjectionResult> {
  if (ev.ownerUserIdSnapshot === null) return PROJECTION_RESULT.CORRUPT_SOURCE;

  const user = await client.user.findUnique({ where: { id: ev.ownerUserIdSnapshot }, select: { id: true } });
  if (!user) return PROJECTION_RESULT.TERMINALLY_NOT_APPLICABLE;

  const fact: AcquisitionFact = {
    acquisitionKey: acquisitionKeyFor(ev.operationKey),
    userId: ev.ownerUserIdSnapshot,
    volumeId: ev.volumeId,
    quantity: ev.quantity,
    channel: ACQUISITION_CHANNEL.RETAIL_PICKUP,
    occurredAt: ev.createdAt,
  };
  return applyAcquisition(fact, client);
}

/**
 * Eventos `PICKED_UP` PENDIENTES (candidatos): doble anti-join contra `Acquisition` (aún sin aplicar) y contra
 * `User` (destino existente), con snapshot presente. Orden DETERMINISTA por `event.id`, SIN offset (los
 * aplicados salen del set → el barrido auto-avanza). `batchSize` acota la página.
 */
export async function findPendingPickups(client: Client, batchSize: number, afterEventId = 0): Promise<PickupEvent[]> {
  return client.$queryRaw<PickupEvent[]>`
    SELECT e.id AS "eventId", e."operationKey" AS "operationKey", e.quantity AS "quantity",
           e."createdAt" AS "createdAt", e."ownerUserIdSnapshot" AS "ownerUserIdSnapshot", l."volumeId" AS "volumeId"
    FROM "StoreOrderLineEvent" e
    JOIN "StoreOrderLine" l ON l.id = e."orderLineId"
    JOIN "User" u ON u.id = e."ownerUserIdSnapshot"
    LEFT JOIN "Acquisition" a ON a."acquisitionKey" = ${ACQUISITION_KEY_PREFIX} || e."operationKey"
    WHERE e.type = 'PICKED_UP' AND e."ownerUserIdSnapshot" IS NOT NULL AND a.id IS NULL AND e.id > ${afterEventId}
    ORDER BY e.id ASC
    LIMIT ${batchSize}
  `;
}

// --- Proyección inmediata post-commit (Paso 6) ----------------------------------------------------------
// Orquestación de la capa de aplicación: la server action de pickup, DESPUÉS de que Retail committeó, proyecta
// SOLO los eventos de esa acción (por sus operationKeys exactas). NO barre, no pagina, no toma advisory lock.

/** Recuento por resultado de una tanda de proyección inmediata (superficie observable). */
export interface PickupProjectionTally {
  applied: number;
  alreadyApplied: number;
  terminal: number;
  corrupt: number;
  conflict: number;
  retryable: number;
}
const emptyTally = (): PickupProjectionTally => ({ applied: 0, alreadyApplied: 0, terminal: 0, corrupt: 0, conflict: 0, retryable: 0 });
function bump(t: PickupProjectionTally, r: ProjectionResult): void {
  if (r === PROJECTION_RESULT.APPLIED) t.applied++;
  else if (r === PROJECTION_RESULT.ALREADY_APPLIED) t.alreadyApplied++;
  else if (r === PROJECTION_RESULT.TERMINALLY_NOT_APPLICABLE) t.terminal++;
  else if (r === PROJECTION_RESULT.CORRUPT_SOURCE) t.corrupt++;
  else if (r === PROJECTION_RESULT.CONFLICT) t.conflict++;
  else if (r === PROJECTION_RESULT.RETRYABLE_FAILURE) t.retryable++;
}

/** Carga los eventos PICKED_UP de un conjunto EXACTO de operationKeys (con el volumen de su línea). */
async function loadPickupsByOperationKeys(client: Client, keys: readonly string[]): Promise<PickupEvent[]> {
  if (keys.length === 0) return [];
  return client.$queryRaw<PickupEvent[]>`
    SELECT e.id AS "eventId", e."operationKey" AS "operationKey", e.quantity AS "quantity",
           e."createdAt" AS "createdAt", e."ownerUserIdSnapshot" AS "ownerUserIdSnapshot", l."volumeId" AS "volumeId"
    FROM "StoreOrderLineEvent" e
    JOIN "StoreOrderLine" l ON l.id = e."orderLineId"
    WHERE e.type = 'PICKED_UP' AND e."operationKey" IN (${Prisma.join([...keys])})
    ORDER BY e.id ASC
  `;
}

/**
 * Proyecta los eventos de un conjunto EXACTO de operationKeys y devuelve el recuento tipado. Cada evento pasa
 * por `projectPickupEvent` (que ya devuelve resultados tipados, no excepciones). PUEDE lanzar sólo si falla la
 * lectura de infraestructura; el aislamiento lo garantiza `projectPickupImmediate`.
 */
export async function projectPickupByOperationKeys(keys: readonly string[], client: Client = prisma): Promise<PickupProjectionTally> {
  const tally = emptyTally();
  const events = await loadPickupsByOperationKeys(client, keys);
  for (const ev of events) bump(tally, await projectPickupEvent(client, ev));
  return tally;
}

/**
 * Intento INMEDIATO best-effort tras el commit de Retail. Se invoca desde la server action con `await`; NUNCA
 * lanza: un fallo de Collection queda aislado y no afecta la respuesta exitosa del pickup. Los eventos no
 * aplicados siguen pendientes en el ledger → los recupera el barrido (Paso 7). Clasifica para observabilidad:
 * corrupt/conflict = anomalías; retryable = recuperación posterior; terminal = resultado terminal.
 */
export async function projectPickupImmediate(keys: readonly string[], client: Client = prisma): Promise<PickupProjectionTally> {
  try {
    const tally = await projectPickupByOperationKeys(keys, client);
    if (tally.corrupt || tally.conflict) console.warn("[collection] anomalía en proyección inmediata:", tally);
    else if (tally.retryable) console.warn("[collection] proyección inmediata con reintentos pendientes (recupera el barrido):", tally);
    else if (tally.terminal) console.info("[collection] proyección inmediata con terminales:", tally);
    else console.info("[collection] proyección inmediata:", tally);
    return tally;
  } catch (err) {
    // Aislamiento total: el pickup ya está committeado; el barrido recupera los eventos pendientes.
    console.error("[collection] proyección inmediata falló (se recupera por el barrido):", err);
    return emptyTally();
  }
}

/** Auditoría: eventos `PICKED_UP` con snapshot NULO (fuente corrupta/inesperada → alarma). Determinista por id. */
export async function findCorruptPickups(client: Client, batchSize: number): Promise<{ eventId: number; operationKey: string }[]> {
  return client.$queryRaw`
    SELECT e.id AS "eventId", e."operationKey" AS "operationKey"
    FROM "StoreOrderLineEvent" e
    WHERE e.type = 'PICKED_UP' AND e."ownerUserIdSnapshot" IS NULL
    ORDER BY e.id ASC
    LIMIT ${batchSize}
  `;
}

/**
 * Auditoría: eventos con snapshot presente cuyo destino (`User`) ya NO existe y SIN `Acquisition` = abandono
 * DELIBERADO por eliminación de cuenta (distinto de "perdido/corrupto"). Determinista por id.
 */
export async function findTerminalPickups(client: Client, batchSize: number): Promise<{ eventId: number; operationKey: string; ownerUserIdSnapshot: string }[]> {
  return client.$queryRaw`
    SELECT e.id AS "eventId", e."operationKey" AS "operationKey", e."ownerUserIdSnapshot" AS "ownerUserIdSnapshot"
    FROM "StoreOrderLineEvent" e
    LEFT JOIN "User" u ON u.id = e."ownerUserIdSnapshot"
    LEFT JOIN "Acquisition" a ON a."acquisitionKey" = ${ACQUISITION_KEY_PREFIX} || e."operationKey"
    WHERE e.type = 'PICKED_UP' AND e."ownerUserIdSnapshot" IS NOT NULL AND u.id IS NULL AND a.id IS NULL
    ORDER BY e.id ASC
    LIMIT ${batchSize}
  `;
}
