/**
 * Infra: implementa el puerto de "responder InfoRequest" (lib/domain/proposal/
 * answerInfo) con Prisma. Escritura INDIVISIBLE bajo lock de la propuesta:
 * lock → [originador] → lookup contribución por key → [replay: comparar huella] →
 * [nuevo: validar request + nivel → create contribución+claims → cerrar request →
 * transición condicional a SUBMITTED]. Mismo orden de lock que RequestProposalInfo.
 * Traduce P2002 (idempotencyKey) a `ProposalAlreadyExistsError`. Reusa el error de
 * captura de CreateProposal y `ProposalNotFoundError` de RequestProposalInfo.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import { ProposalNotFoundError } from "@/lib/domain/proposal/requestInfo";
import {
  assertClaimsLevelForTarget,
  assertCompatibleAnswerReplay,
  assertRequestAnswerable,
  InfoRequestNotAnswerableError,
  NotProposalOriginatorError,
  ANSWER_VISIBILITY,
  INFO_SCOPE_PROPOSAL,
  INFO_STATUS_ANSWERED,
  INFO_STATUS_OPEN,
  PROPOSAL_STATUS_NEEDS_INFO,
  PROPOSAL_STATUS_SUBMITTED,
  type AnswerOutcome,
  type AnswerReadPort,
  type AnswerWritePort,
  type ExistingAnswerContribution,
  type LockedProposalForAnswer,
} from "@/lib/domain/proposal/answerInfo";

type Db = Pick<Prisma.TransactionClient, "catalogProposal" | "proposalInfoRequest" | "proposalContribution">;

async function contributionByKey(db: Db, key: string): Promise<ExistingAnswerContribution | null> {
  const c = await db.proposalContribution.findUnique({
    where: { idempotencyKey: key },
    select: {
      id: true, proposalId: true, authorId: true, answersInfoRequestId: true,
      claims: { select: { attributeKind: true, contractVersion: true, claimOperation: true, value: true } },
    },
  });
  if (!c) return null;
  return {
    id: c.id,
    proposalId: c.proposalId,
    authorId: c.authorId,
    answersInfoRequestId: c.answersInfoRequestId,
    claims: c.claims.map((cl) => ({
      attributeKind: cl.attributeKind,
      contractVersion: cl.contractVersion,
      claimOperation: cl.claimOperation,
      value: cl.value ?? null,
    })),
  };
}

function readPort(db: Db): AnswerReadPort {
  return { findContributionByIdempotencyKey: (key) => contributionByKey(db, key) };
}

export function answerWritePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: AnswerOutcome) => void,
): AnswerWritePort {
  return {
    async answer(seed) {
      // 1. Lock de la propuesta (mismo orden que RequestProposalInfo).
      const locked = await tx.$queryRaw<LockedProposalForAnswer[]>(
        Prisma.sql`SELECT id, status, "originatorUserId", "targetKind", version FROM "CatalogProposal" WHERE id = ${seed.proposalId} FOR UPDATE`,
      );
      const proposal = locked[0];
      if (!proposal) throw new ProposalNotFoundError();

      // 2. Originador ANTES de la idempotencia (seguridad).
      if (proposal.originatorUserId !== seed.authorId) throw new NotProposalOriginatorError();

      // 3. Replay por idempotencyKey (bajo el lock).
      const existing = await contributionByKey(tx, seed.idempotencyKey);
      if (existing) {
        assertCompatibleAnswerReplay(seed, existing); // incompatible → IdempotencyConflictError
        const out: AnswerOutcome = {
          proposalId: seed.proposalId,
          contributionId: existing.id,
          infoRequestId: seed.infoRequestId,
          proposalStatus: proposal.status,
          recovered: true,
        };
        onCommitted(out);
        return out;
      }

      // 4. Nueva respuesta: validar propuesta NEEDS_INFO + request elegible.
      if (proposal.status !== PROPOSAL_STATUS_NEEDS_INFO) throw new InfoRequestNotAnswerableError();
      const req = await tx.proposalInfoRequest.findUnique({
        where: { id: seed.infoRequestId },
        select: { id: true, proposalId: true, scope: true, targetUserId: true, targetContributionId: true, status: true },
      });
      assertRequestAnswerable(req, seed.proposalId); // pertenece + PROPOSAL + originador + ABIERTO
      assertClaimsLevelForTarget(seed.claims, proposal.targetKind);

      // 5. Crear contribución + claims (nested), vinculada al request.
      let contributionId: number;
      try {
        const created = await tx.proposalContribution.create({
          data: {
            proposalId: seed.proposalId,
            authorId: seed.authorId,
            visibility: ANSWER_VISIBILITY,
            answersInfoRequestId: seed.infoRequestId,
            idempotencyKey: seed.idempotencyKey,
            claims: {
              create: seed.claims.map((c) => ({
                attributeKind: c.attributeKind,
                contractVersion: c.contractVersion,
                claimOperation: c.claimOperation,
                value: c.value === null || c.value === undefined ? Prisma.DbNull : (c.value as Prisma.InputJsonValue),
                result: "PROPUESTA",
              })),
            },
          },
          select: { id: true },
        });
        contributionId = created.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          String(err.meta?.target ?? "").includes("idempotencyKey")
        )
          throw new ProposalAlreadyExistsError(seed.idempotencyKey);
        throw err;
      }

      // 6. Cerrar el request.
      await tx.proposalInfoRequest.update({
        where: { id: seed.infoRequestId },
        data: { status: INFO_STATUS_ANSWERED, answeredAt: new Date() },
      });

      // 7. Transición DEFENSIVA: SUBMITTED solo si no queda ningún request abierto.
      const stillOpen = await tx.proposalInfoRequest.findFirst({
        where: { proposalId: seed.proposalId, status: INFO_STATUS_OPEN },
        select: { id: true },
      });
      let proposalStatus: string = proposal.status;
      if (!stillOpen) {
        await tx.catalogProposal.update({
          where: { id: seed.proposalId },
          data: { status: PROPOSAL_STATUS_SUBMITTED, version: { increment: 1 } },
        });
        proposalStatus = PROPOSAL_STATUS_SUBMITTED;
      }

      const out: AnswerOutcome = {
        proposalId: seed.proposalId,
        contributionId,
        infoRequestId: seed.infoRequestId,
        proposalStatus,
        recovered: false,
      };
      onCommitted(out);
      return out;
    },
  };
}

export interface AnswerInfoIO {
  readonly io: Pick<RunOptions<AnswerReadPort, AnswerWritePort>, "read" | "transaction">;
  getCommittedResult(): AnswerOutcome;
}

export function prismaAnswerInfoIO(): AnswerInfoIO {
  let committed: AnswerOutcome | null = null;
  const onCommitted = (r: AnswerOutcome) => {
    committed = { ...r };
  };
  return {
    io: {
      read: readPort(prisma),
      transaction: {
        run: (fn) =>
          prisma.$transaction(
            (tx) => fn({ read: readPort(tx), write: answerWritePort(tx, onCommitted) }),
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
