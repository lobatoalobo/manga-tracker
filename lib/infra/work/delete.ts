/**
 * Infra: implementa los puertos de dominio del borrado de Work (lib/domain/work/
 * delete) con Prisma. Único lugar que conoce Prisma para esta operación.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyDeleteWorkInTx } from "@/lib/mergeWorks";
import type {
  DeleteWorkReadPort,
  DeleteWorkWritePort,
} from "@/lib/domain/work/delete";
import type { RunOptions } from "@/lib/mutations";

const identitySelect = { id: true, title: true, anilistId: true } satisfies Prisma.WorkSelect;

type DbRead = Pick<Prisma.TransactionClient, "work" | "publisherEdition" | "manga" | "wishlistItem">;

function deleteReadPort(db: DbRead): DeleteWorkReadPort {
  return {
    loadIdentity: (id) => db.work.findUnique({ where: { id }, select: identitySelect }),
    impact: async (plan) => {
      const [editions, collection, wishlist] = await Promise.all([
        db.publisherEdition.count({ where: { workId: plan.workId } }),
        db.manga.count({ where: { anilistId: plan.domainKey } }),
        db.wishlistItem.count({ where: { anilistId: plan.domainKey } }),
      ]);
      return { editions, collection, wishlist };
    },
  };
}

function deleteWritePort(tx: Prisma.TransactionClient): DeleteWorkWritePort {
  return {
    lockWork: async (id) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1 FROM "Work" WHERE id = ${id} FOR UPDATE`);
    },
    applyDelete: (plan) => applyDeleteWorkInTx(tx, plan),
  };
}

/** IO de datos (read-port + transacción) para la mutación `deleteWork`. */
export function prismaDeleteWorkIO(): Pick<
  RunOptions<DeleteWorkReadPort, DeleteWorkWritePort>,
  "read" | "transaction"
> {
  return {
    read: deleteReadPort(prisma),
    transaction: {
      run: (fn) =>
        prisma.$transaction(
          (tx) => fn({ read: deleteReadPort(tx), write: deleteWritePort(tx) }),
          { timeout: 30000 },
        ),
    },
  };
}
