import { type PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import type { AuditSink } from "@/lib/mutations";
import type { AuditEntry, Idempotency, IdempotencyStore } from "@/lib/mutations";

/**
 * Adapters Prisma transversales del Mutation Framework: persistencia de auditoría
 * e idempotencia (sirven a CUALQUIER mutación, no a una en particular). Vive FUERA
 * de `lib/mutations/` para que el core quede Prisma-free de verdad (zero imports de
 * Prisma en todo el árbol del core). El IO de datos por operación (read/write-ports
 * + transacción) vive junto al dominio (ej. lib/infra/work/merge.ts).
 */

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
