import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import type { AuditSink } from "../audit/sink";
import type { AuditEntry } from "../audit/types";
import type {
  EntityRef,
  Idempotency,
  IdempotencyStore,
  RunOptions,
  TransactionRunner,
} from "../types";

/**
 * Adapter Prisma del Mutation Framework. ES EL ÚNICO archivo del framework que
 * conoce Prisma: provee el `read` (cliente de lectura) y el `TransactionRunner`
 * que abre la tx y arma los handles `read`/`write` que la mutación consume. El
 * core (`run.ts`) sigue sin importar Prisma.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `SELECT … FOR UPDATE` por tabla: lock pesimista de las filas referenciadas. */
async function lockRows(tx: Prisma.TransactionClient, refs: readonly EntityRef[]): Promise<void> {
  const byTable = new Map<string, (string | number)[]>();
  for (const r of refs) {
    if (!IDENT.test(r.table)) throw new Error(`tabla inválida para lock: ${r.table}`);
    (byTable.get(r.table) ?? byTable.set(r.table, []).get(r.table)!).push(r.id);
  }
  for (const [table, ids] of byTable) {
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM ${Prisma.raw(`"${table}"`)} WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`,
    );
  }
}

/**
 * Construye los `RunOptions` de acceso a datos (`read` + `transaction`) para una
 * corrida. El resto (actor, dryRun, audit, confirm…) lo pone el caller.
 */
export function prismaMutationIO(
  client: PrismaClient = defaultClient,
  txTimeoutMs = 30000,
): Pick<RunOptions, "read" | "transaction"> {
  const transaction: TransactionRunner = {
    run: (fn) =>
      client.$transaction(
        (tx) => fn({ read: tx, write: { client: tx, lock: (refs) => lockRows(tx, refs) } }),
        { timeout: txTimeoutMs },
      ),
  };
  return { read: client, transaction };
}

/**
 * Persiste cada `AuditEntry` en `MutationLog` (1:1, aplanado). NUNCA rompe la
 * mutación: si la escritura del log falla, cae a consola (el log es observabilidad,
 * no debe tumbar una operación ya commiteada). Ver memoria maintenance-tooling-robust.
 */
export class PrismaAuditSink implements AuditSink {
  constructor(private readonly client: PrismaClient = defaultClient) {}
  async record(e: AuditEntry): Promise<void> {
    try {
      await this.client.mutationLog.create({
        data: {
          schemaVersion: e.schemaVersion,
          frameworkVersion: e.frameworkVersion,
          definitionVersion: e.definitionVersion,
          phase: e.phase,
          name: e.name,
          kind: e.kind,
          actorType: e.actor.type,
          actorId: e.actor.id,
          env: e.env,
          correlationId: e.correlationId,
          requestId: e.requestId ?? null,
          dryRun: e.dryRun,
          creates: e.affected?.creates ?? null,
          updates: e.affected?.updates ?? null,
          deletes: e.affected?.deletes ?? null,
          entities: e.affected?.entities ? [...e.affected.entities] : [],
          irreversible: e.irreversible ?? null,
          summaryDomain: e.summary?.domain ?? null,
          summaryHuman: e.summary?.human ?? null,
          warnings: e.warnings ? [...e.warnings] : [],
          mutationKey: e.mutationKey ?? null,
          mutationScope: e.mutationScope ?? null,
          durationMs: e.durationMs ?? null,
          errorName: e.error?.name ?? null,
          errorMessage: e.error?.message ?? null,
          at: e.at,
        },
      });
    } catch (err) {
      console.error("[PrismaAuditSink] no pudo persistir; entrada:", e, err);
    }
  }
}

/**
 * Idempotencia respaldada por `MutationLog`: una operación ya corrió si existe una
 * fila `success` no-dry con su `mutationKey` (+scope). `expiresAt` (opcional)
 * acota la ventana: pasado ese instante, un re-run cuenta como fresco.
 */
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly client: PrismaClient = defaultClient) {}
  async wasExecuted(idem: Idempotency, now: Date): Promise<boolean> {
    if (idem.expiresAt && now.getTime() > idem.expiresAt.getTime()) return false;
    const row = await this.client.mutationLog.findFirst({
      where: {
        phase: "success",
        dryRun: false,
        mutationKey: idem.key,
        ...(idem.scope ? { mutationScope: idem.scope } : {}),
      },
      select: { id: true },
    });
    return row != null;
  }
}
