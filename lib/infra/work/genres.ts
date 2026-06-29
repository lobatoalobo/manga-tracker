/**
 * Infra: implementa los puertos del enrich de géneros con Prisma.
 */
import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  GenreEnrichReadPort,
  GenreEnrichWritePort,
} from "@/lib/domain/work/genres";
import type { RunOptions } from "@/lib/mutations";

const candidateSelect = {
  id: true, title: true, genres: true, rawGenres: true, demographic: true, curated: true,
} satisfies Prisma.WorkSelect;

type DbRead = Pick<Prisma.TransactionClient, "work">;

function readPort(db: DbRead): GenreEnrichReadPort {
  return { loadCandidates: () => db.work.findMany({ select: candidateSelect }) };
}

function writePort(tx: Prisma.TransactionClient): GenreEnrichWritePort {
  return {
    applyPatches: async (plan) => {
      for (const p of plan) {
        await tx.work.update({ where: { id: p.workId }, data: p.data as Prisma.WorkUpdateInput });
      }
      return plan.length;
    },
  };
}

/** IO de datos para la mutación `normalizeGenres`. */
export function prismaGenreEnrichIO(): Pick<
  RunOptions<GenreEnrichReadPort, GenreEnrichWritePort>,
  "read" | "transaction"
> {
  return {
    read: readPort(prisma),
    transaction: {
      run: (fn) =>
        prisma.$transaction(
          (tx) => fn({ read: readPort(tx), write: writePort(tx) }),
          { timeout: 60000 }, // enrich de catálogo completo: más generoso
        ),
    },
  };
}
