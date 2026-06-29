import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import type { EntityRef, RunOptions, TransactionRunner } from "../types";

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
