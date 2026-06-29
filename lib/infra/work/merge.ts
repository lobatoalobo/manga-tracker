/**
 * Infra: implementa los PUERTOS de dominio de la fusión (lib/domain/work/merge)
 * con Prisma. Es el ÚNICO lugar que conoce Prisma para esta operación. Construye
 * los puertos llamando a Prisma (no castea handles opacos) y arma el IO
 * (read-port + TransactionRunner) que la mutación inyecta en el framework.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyMergeInTx, mergeWorkSelect } from "@/lib/mergeWorks";
import type {
  MergeReadPort,
  MergeWritePort,
  SeriesIdentity,
} from "@/lib/domain/work/merge";
import type { RunOptions } from "@/lib/mutations";

const identitySelect = {
  title: true, anilistId: true, muId: true, mdId: true, originalTitle: true,
} satisfies Prisma.WorkSelect;

/** Delegates de Prisma que el read-port usa (lo cumplen PrismaClient y la tx). */
type DbRead = Pick<Prisma.TransactionClient, "work" | "publisherEdition">;

function mergeReadPort(db: DbRead): MergeReadPort {
  return {
    loadIdentity: (id) =>
      db.work.findUnique({ where: { id }, select: identitySelect }) as Promise<SeriesIdentity | null>,
    loadRow: (id) => db.work.findUnique({ where: { id }, select: mergeWorkSelect }),
    countEditions: (workId) => db.publisherEdition.count({ where: { workId } }),
  };
}

function mergeWritePort(tx: Prisma.TransactionClient): MergeWritePort {
  return {
    lockWorks: async (ids) => {
      if (ids.length === 0) return;
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Work" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`,
      );
    },
    applyPlan: (plan) => applyMergeInTx(tx, plan),
  };
}

/** IO de datos (read-port + transacción) para la mutación `mergeWork`. */
export function prismaMergeIO(): Pick<
  RunOptions<MergeReadPort, MergeWritePort>,
  "read" | "transaction"
> {
  return {
    read: mergeReadPort(prisma),
    transaction: {
      run: (fn) =>
        prisma.$transaction(
          (tx) => fn({ read: mergeReadPort(tx), write: mergeWritePort(tx) }),
          { timeout: 30000 },
        ),
    },
  };
}
