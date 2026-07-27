/**
 * Collection (Slice 8) — barrido durable de proyección (Paso 7). Recupera los `PICKED_UP` pendientes que el
 * intento inmediato no proyectó. Vive acá (no depende de la ruta HTTP). Ver ADR-010 §D3/§D8.
 *
 * ## Advisory lock por SESIÓN, con afinidad de conexión (crítico)
 * Los advisory locks de PostgreSQL son por sesión. Con el pool normal de Prisma, `pg_try_advisory_lock` y
 * `pg_advisory_unlock` podrían salir por conexiones distintas → el unlock no libera lo que otro backend tomó.
 * No se puede usar `pg_advisory_xact_lock` porque cada evento se aplica en SU propia transacción (el lock debe
 * sobrevivir a todas). Solución: un `PrismaClient` DEDICADO con `connection_limit=1` → una sola conexión física
 * para el lock, las lecturas, cada apply y el unlock. El unlock va en `finally` sobre esa misma sesión, y el
 * `$disconnect` final la cierra (libera cualquier lock remanente como defensa adicional).
 *
 * ## Terminación y ausencia de loop
 * - CORRUPT (snapshot nulo) y los terminales (destino inexistente) NO entran al set pendiente: el anti-join los
 *   excluye (`ownerUserIdSnapshot IS NOT NULL` + `JOIN User`). Se auditan aparte (findCorruptPickups /
 *   findTerminalPickups). Por eso no pueden generar un loop en el barrido.
 * - CONFLICT requiere que la clave derivada ya tenga una Acquisition → el anti-join también lo excluye del set.
 * - RETRYABLE deja el evento pendiente (para la próxima corrida). Un cursor keyset EN MEMORIA (`e.id > cursor`,
 *   NO un watermark persistido) evita re-visitarlo en la MISMA corrida → avance garantizado y terminación por
 *   página vacía. El presupuesto de tiempo corta antes de `maxDuration`.
 */
import { PrismaClient } from "@prisma/client";
import { PROJECTION_RESULT, type ProjectionResult } from "@/lib/domain/collection/result";
import { findPendingPickups, projectPickupEvent } from "@/lib/collection-context/projection";

/** Clave del advisory lock de sesión que serializa los barridos (uno activo a la vez). */
export const SWEEP_LOCK_KEY = 852026;

export interface SweepSummary {
  applied: number;
  alreadyApplied: number;
  terminallyNotApplicable: number;
  corruptSource: number;
  conflict: number;
  retryableFailure: number;
  processed: number;
  durationMs: number;
  stoppedByTimeBudget: boolean;
  lockAcquired: boolean;
}

export interface SweepOptions {
  databaseUrl?: string;
  batchSize?: number;
  timeBudgetMs?: number;
  nowFn?: () => number;
}

const emptySummary = (): SweepSummary => ({
  applied: 0, alreadyApplied: 0, terminallyNotApplicable: 0, corruptSource: 0, conflict: 0,
  retryableFailure: 0, processed: 0, durationMs: 0, stoppedByTimeBudget: false, lockAcquired: false,
});

function count(s: SweepSummary, r: ProjectionResult): void {
  if (r === PROJECTION_RESULT.APPLIED) s.applied++;
  else if (r === PROJECTION_RESULT.ALREADY_APPLIED) s.alreadyApplied++;
  else if (r === PROJECTION_RESULT.TERMINALLY_NOT_APPLICABLE) s.terminallyNotApplicable++;
  else if (r === PROJECTION_RESULT.CORRUPT_SOURCE) s.corruptSource++;
  else if (r === PROJECTION_RESULT.CONFLICT) s.conflict++;
  else if (r === PROJECTION_RESULT.RETRYABLE_FAILURE) s.retryableFailure++;
}

/** `connection_limit=1` → un único backend: el advisory lock de sesión persiste por TODO el barrido. */
function withSingleConnection(url: string): string {
  return url.includes("?") ? `${url}&connection_limit=1` : `${url}?connection_limit=1`;
}

/**
 * Barre y proyecta los `PICKED_UP` pendientes. Idempotente y aislado por evento. Devuelve el resumen tipado; si
 * otro barrido ya está corriendo, sale limpio con `lockAcquired: false` (no es error).
 */
export async function sweepPickupProjections(options: SweepOptions = {}): Promise<SweepSummary> {
  const batchSize = options.batchSize ?? 200;
  const timeBudgetMs = options.timeBudgetMs ?? 50_000;
  const nowFn = options.nowFn ?? Date.now;
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("[collection] sweep: falta DATABASE_URL");

  const startedAt = nowFn();
  const deadline = startedAt + timeBudgetMs;
  const summary = emptySummary();

  const client = new PrismaClient({ datasourceUrl: withSingleConnection(url) });
  try {
    const rows = await client.$queryRawUnsafe<Array<{ locked: boolean }>>(`SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS locked`);
    summary.lockAcquired = rows[0]?.locked === true;
    if (!summary.lockAcquired) {
      summary.durationMs = nowFn() - startedAt; // ya en ejecución → salida limpia (no es error)
      return summary;
    }

    let cursor = 0; // keyset en memoria (no persistido): garantiza avance y evita re-hammering de reintentables
    outer: while (true) {
      if (nowFn() >= deadline) { summary.stoppedByTimeBudget = true; break; }
      const page = await findPendingPickups(client, batchSize, cursor);
      if (page.length === 0) break; // conjunto agotado
      for (const ev of page) {
        if (nowFn() >= deadline) { summary.stoppedByTimeBudget = true; break outer; }
        let r: ProjectionResult;
        try {
          r = await projectPickupEvent(client, ev); // cada evento en su propia $transaction
        } catch (err) {
          console.error("[collection] sweep: evento falló; se reintenta en la próxima corrida:", ev.eventId, err);
          r = PROJECTION_RESULT.RETRYABLE_FAILURE; // un fallo NO detiene el resto del batch
        }
        count(summary, r);
        summary.processed++;
        cursor = ev.eventId;
      }
    }
    summary.durationMs = nowFn() - startedAt;
    return summary;
  } finally {
    if (summary.lockAcquired) {
      try { await client.$queryRawUnsafe(`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`); }
      catch (err) { console.error("[collection] sweep: fallo al liberar el advisory lock:", err); }
    }
    await client.$disconnect();
  }
}
