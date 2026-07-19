/**
 * Infra: implementa el puerto de "solicitar información" (lib/domain/proposal/
 * requestInfo) con Prisma. Único lugar que conoce Prisma para esta operación. La
 * escritura es INDIVISIBLE bajo un lock pesimista de la propuesta: lock (SELECT …
 * FOR UPDATE) → lookup por idempotencyKey → [replay: comparar payload puro] → [nuevo:
 * validar estado + no-open → create InfoRequest + transición status/version]. Traduce
 * el unique de `idempotencyKey` (P2002) a `ProposalAlreadyExistsError`. Reusa el
 * error de captura del slice CreateProposal.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import {
  assertCompatibleInfoReplay,
  assertRequestableForNew,
  OpenRequestExistsError,
  ProposalNotFoundError,
  INFO_SCOPE_PROPOSAL,
  INFO_STATUS_OPEN,
  PROPOSAL_STATUS_NEEDS_INFO,
  type ExistingInfoRequest,
  type LockedProposal,
  type RequestInfoOutcome,
  type RequestInfoReadPort,
  type RequestInfoSeed,
  type RequestInfoWritePort,
} from "@/lib/domain/proposal/requestInfo";

type Db = Pick<Prisma.TransactionClient, "catalogProposal" | "proposalInfoRequest">;

async function infoRequestByKey(db: Db, key: string): Promise<ExistingInfoRequest | null> {
  const r = await db.proposalInfoRequest.findUnique({
    where: { idempotencyKey: key },
    select: {
      id: true, proposalId: true, scope: true, targetUserId: true,
      targetContributionId: true, prompt: true, privateNote: true,
    },
  });
  return r
    ? {
        infoRequestId: r.id,
        proposalId: r.proposalId,
        scope: r.scope,
        targetUserId: r.targetUserId,
        targetContributionId: r.targetContributionId,
        prompt: r.prompt,
        privateNote: r.privateNote,
      }
    : null;
}

function readPort(db: Db): RequestInfoReadPort {
  return { findByIdempotencyKey: (key) => infoRequestByKey(db, key) };
}

export function requestInfoWritePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: RequestInfoOutcome) => void,
): RequestInfoWritePort {
  return {
    async requestInfo(seed) {
      // 1. Lock pesimista de la propuesta (serializa moderadores concurrentes).
      const locked = await tx.$queryRaw<LockedProposal[]>(
        Prisma.sql`SELECT id, status, version FROM "CatalogProposal" WHERE id = ${seed.proposalId} FOR UPDATE`,
      );
      const proposal = locked[0];
      if (!proposal) throw new ProposalNotFoundError();

      // 2. Replay por idempotencyKey (bajo el lock).
      const existing = await infoRequestByKey(tx, seed.idempotencyKey);
      if (existing) {
        assertCompatibleInfoReplay(seed, existing); // incompatible → IdempotencyConflictError
        const out: RequestInfoOutcome = {
          proposalId: seed.proposalId,
          infoRequestId: existing.infoRequestId,
          proposalStatus: proposal.status,
          recovered: true,
        };
        onCommitted(out);
        return out;
      }

      // 3. Nueva: solo desde SUBMITTED, y sin otra solicitud abierta.
      assertRequestableForNew(proposal.status);
      const open = await tx.proposalInfoRequest.findFirst({
        where: { proposalId: seed.proposalId, status: INFO_STATUS_OPEN },
        select: { id: true },
      });
      if (open) throw new OpenRequestExistsError();

      // 4. Crear InfoRequest + transición (atómico dentro de la tx).
      let infoRequestId: number;
      try {
        const created = await tx.proposalInfoRequest.create({
          data: {
            proposalId: seed.proposalId,
            scope: INFO_SCOPE_PROPOSAL,
            targetUserId: null,
            targetContributionId: null,
            prompt: seed.prompt,
            privateNote: seed.privateNote,
            status: INFO_STATUS_OPEN,
            openedByUserId: seed.openedByUserId,
            idempotencyKey: seed.idempotencyKey,
          },
          select: { id: true },
        });
        infoRequestId = created.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          String(err.meta?.target ?? "").includes("idempotencyKey")
        )
          throw new ProposalAlreadyExistsError(seed.idempotencyKey);
        throw err;
      }

      await tx.catalogProposal.update({
        where: { id: seed.proposalId },
        data: { status: PROPOSAL_STATUS_NEEDS_INFO, version: { increment: 1 } },
      });

      const out: RequestInfoOutcome = {
        proposalId: seed.proposalId,
        infoRequestId,
        proposalStatus: PROPOSAL_STATUS_NEEDS_INFO,
        recovered: false,
      };
      onCommitted(out);
      return out;
    },
  };
}

export interface RequestInfoIO {
  readonly io: Pick<
    RunOptions<RequestInfoReadPort, RequestInfoWritePort>,
    "read" | "transaction"
  >;
  getCommittedResult(): RequestInfoOutcome;
}

/**
 * IO (read-port fuera de tx + transacción) para la mutación `requestProposalInfo`.
 * El estado de captura es privado; solo se expone `getCommittedResult`.
 */
export function prismaRequestInfoIO(): RequestInfoIO {
  let committed: RequestInfoOutcome | null = null;
  const onCommitted = (r: RequestInfoOutcome) => {
    committed = { ...r };
  };
  return {
    io: {
      read: readPort(prisma),
      transaction: {
        run: (fn) =>
          prisma.$transaction(
            (tx) => fn({ read: readPort(tx), write: requestInfoWritePort(tx, onCommitted) }),
            { timeout: 15000 },
          ),
      },
    },
    getCommittedResult() {
      if (committed === null) throw new CommittedResultUnavailableError();
      return Object.freeze({ ...committed });
    },
  };
}
