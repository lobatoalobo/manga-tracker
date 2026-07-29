/**
 * Infra: implementa los PUERTOS de dominio de "crear propuesta"
 * (lib/domain/proposal/create) con Prisma. Único lugar que conoce Prisma para esta
 * operación. Arma el read-port + el `TransactionRunner` (que la mutación inyecta en
 * el framework) y CAPTURA los ids creados (el framework solo propaga `affected`, no
 * datos de dominio). La captura queda ENCAPSULADA acá: `prismaCreateProposalIO()`
 * expone únicamente un getter explícito (`getCommittedResult`), nunca el objeto
 * mutable interno. Traduce el unique de `createIdempotencyKey` (P2002) a
 * `ProposalAlreadyExistsError` para que el orquestador reconcilie sin conocer Prisma.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import {
  ProposalAlreadyExistsError,
  type ContentClass,
  type CreateProposalReadPort,
  type CreateProposalWritePort,
} from "@/lib/domain/proposal/create";

/** Resultado de dominio de la creación (ids ya committeados). Inmutable. */
export interface CommittedProposalResult {
  readonly proposalId: number;
  readonly contributionId: number;
  readonly status: string;
}

/** Se pidió el resultado antes de que el write-port lo capturara (invariante interno). */
export class CommittedResultUnavailableError extends Error {
  readonly code = "COMMITTED_RESULT_UNAVAILABLE" as const;
  constructor() {
    super("El resultado de la creación no fue capturado (execute no corrió o falló).");
    this.name = "CommittedResultUnavailableError";
  }
}

/**
 * Holder write-once del resultado committeado. El write-port llama `set()` dentro de
 * la tx; el orquestador llama `get()` DESPUÉS del commit. `set`/`get` COPIAN el
 * valor: ni entra ni sale una referencia mutable interna. Sin acceso a DB.
 */
export function createCommittedProposalResultHolder(): {
  set(v: CommittedProposalResult): void;
  get(): CommittedProposalResult;
} {
  let value: CommittedProposalResult | null = null;
  return {
    set(v) {
      value = {
        proposalId: v.proposalId,
        contributionId: v.contributionId,
        status: v.status,
      };
    },
    get() {
      if (value === null) throw new CommittedResultUnavailableError();
      return Object.freeze({ ...value });
    },
  };
}

/** COMIC vs. resto (misma regla que `sameContentClass` en lib/catalog). */
const toContentClass = (workType: string): ContentClass =>
  workType === "COMIC" ? "COMIC" : "MANGA";

/** Delegates de Prisma que los puertos usan (los cumplen PrismaClient y la tx). */
type DbRead = Pick<
  Prisma.TransactionClient,
  "catalogProposal" | "work" | "publisherEdition" | "volume"
>;

function readPort(db: DbRead): CreateProposalReadPort {
  return {
    async findByIdempotencyKey(key) {
      const p = await db.catalogProposal.findUnique({
        where: { createIdempotencyKey: key },
        select: {
          id: true, status: true, family: true, targetKind: true, contentClass: true,
          refWorkId: true, refEditionId: true, refVolumeId: true, refWorkBId: true,
          relationKind: true,
          contributions: { orderBy: { id: "asc" }, take: 1, select: { id: true } },
        },
      });
      if (!p) return null;
      return {
        id: p.id,
        status: p.status,
        originatingContributionId: p.contributions[0]?.id ?? null,
        family: p.family,
        targetKind: p.targetKind,
        contentClass: p.contentClass,
        refWorkId: p.refWorkId,
        refEditionId: p.refEditionId,
        refVolumeId: p.refVolumeId,
        refWorkBId: p.refWorkBId,
        relationKind: p.relationKind,
      };
    },
    async contentClassOfWork(workId) {
      const w = await db.work.findUnique({ where: { id: workId }, select: { type: true } });
      return w ? toContentClass(w.type) : null;
    },
    async contentClassOfEdition(editionId) {
      const e = await db.publisherEdition.findUnique({
        where: { id: editionId },
        select: { work: { select: { type: true } } },
      });
      return e?.work ? toContentClass(e.work.type) : null;
    },
    async contentClassOfVolume(volumeId) {
      const v = await db.volume.findUnique({
        where: { id: volumeId },
        select: { edition: { select: { work: { select: { type: true } } } } },
      });
      return v?.edition?.work ? toContentClass(v.edition.work.type) : null;
    },
  };
}

function writePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: CommittedProposalResult) => void,
): CreateProposalWritePort {
  return {
    async insertProposalWithOriginator(seed) {
      try {
        const created = await tx.catalogProposal.create({
          data: {
            family: seed.family,
            targetKind: seed.targetKind,
            contentClass: seed.contentClass,
            refWorkId: seed.refWorkId,
            refEditionId: seed.refEditionId,
            refVolumeId: seed.refVolumeId,
            refWorkBId: seed.refWorkBId,
            relationKind: seed.relationKind,
            createIdempotencyKey: seed.createIdempotencyKey,
            originatorUserId: seed.originatorUserId,
            // Contribución originadora en la MISMA operación (nunca 0 contribuciones).
            contributions: { create: { authorId: seed.originatorUserId } },
          },
          select: { id: true, status: true, contributions: { select: { id: true } } },
        });
        const result: CommittedProposalResult = {
          proposalId: created.id,
          contributionId: created.contributions[0]!.id,
          status: created.status,
        };
        onCommitted(result); // captura encapsulada (write-only)
        return result;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          String(err.meta?.target ?? "").includes("createIdempotencyKey")
        )
          throw new ProposalAlreadyExistsError(seed.createIdempotencyKey);
        throw err;
      }
    },
  };
}

export interface CreateProposalIO {
  readonly io: Pick<
    RunOptions<CreateProposalReadPort, CreateProposalWritePort>,
    "read" | "transaction"
  >;
  /** Devuelve una COPIA inmutable del resultado; lanza si aún no fue capturado. */
  getCommittedResult(): CommittedProposalResult;
}

/**
 * IO de datos (read-port + transacción) para la mutación `createCatalogProposal`.
 * El estado de captura es privado (holder en closure); solo se expone `getCommittedResult`,
 * que el orquestador llama tras un `runMutation` exitoso.
 */
export function prismaCreateProposalIO(): CreateProposalIO {
  const holder = createCommittedProposalResultHolder();
  return {
    io: {
      read: readPort(prisma),
      transaction: {
        run: (fn) =>
          prisma.$transaction(
            (tx) => fn({ read: readPort(tx), write: writePort(tx, holder.set) }),
            { timeout: 15000 },
          ),
      },
    },
    getCommittedResult: () => holder.get(),
  };
}
