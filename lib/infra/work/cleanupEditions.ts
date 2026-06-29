/**
 * Infra: implementa los puertos del cleanup de ediciones redundantes con Prisma.
 * La DETECCIÓN reusa `getEditionDuplicateGroups` (lib/mergeWorks). Nota: el
 * read-port es de detección — solo se usa en preview (execute consume el plan), así
 * que usa el cliente global, no la tx; no rompe nada porque execute no re-lee.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEditionDuplicateGroups } from "@/lib/mergeWorks";
import type {
  CleanEditionsReadPort,
  CleanEditionsWritePort,
} from "@/lib/domain/work/cleanupEditions";
import type { RunOptions } from "@/lib/mutations";

function cleanReadPort(): CleanEditionsReadPort {
  return {
    loadRedundantGroups: async () => {
      const groups = await getEditionDuplicateGroups();
      return groups
        .filter((g) => g.sameWork) // redundantes en el MISMO Work (no mis-merges)
        .map((g) => ({
          publisher: g.publisher,
          normTitle: g.normTitle,
          editions: g.editions.map((e) => ({
            id: e.id, slug: e.slug, volumes: e.volumes, anilistId: e.anilistId,
          })),
        }));
    },
  };
}

function cleanWritePort(tx: Prisma.TransactionClient): CleanEditionsWritePort {
  return {
    deleteEditions: async (ids) => {
      if (ids.length === 0) return 0;
      const r = await tx.publisherEdition.deleteMany({ where: { id: { in: ids } } });
      return r.count;
    },
  };
}

/** IO de datos para la mutación `cleanRedundantEditions`. */
export function prismaCleanEditionsIO(): Pick<
  RunOptions<CleanEditionsReadPort, CleanEditionsWritePort>,
  "read" | "transaction"
> {
  return {
    read: cleanReadPort(),
    transaction: {
      run: (fn) =>
        prisma.$transaction(
          (tx) => fn({ read: cleanReadPort(), write: cleanWritePort(tx) }),
          { timeout: 30000 },
        ),
    },
  };
}
