/**
 * Caso de uso "responder InfoRequest": normaliza/valida (dominio), corre la mutación
 * (audit → MutationLog) y recupera el resultado. Idempotencia autoritativa por
 * `ProposalContribution.idempotencyKey`: el replay bajo el lock lo resuelve el
 * write-port; una carrera cross-proposal por P2002 se reconcilia acá. La auth (flag +
 * sesión) vive en la action; el chequeo de originador vive en el write-port (bajo el
 * lock, ANTES de la idempotencia).
 */
import {
  CompositeAuditSink,
  ConsoleAuditSink,
  runMutation,
} from "@/lib/mutations";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { prismaAnswerInfoIO } from "@/lib/infra/proposal/answerInfo";
import { answerProposalInfoRequest } from "@/lib/contributions/mutations/answerProposalInfoRequest";
import {
  assertCompatibleAnswerReplay,
  buildAnswerSeed,
  PROPOSAL_STATUS_SUBMITTED,
  type AnswerProposalInfoRequestCommand,
} from "@/lib/domain/proposal/answerInfo";

export {
  IdempotencyConflictError,
  InfoRequestNotAnswerableError,
  NotProposalOriginatorError,
} from "@/lib/domain/proposal/answerInfo";
export { ProposalNotFoundError } from "@/lib/domain/proposal/requestInfo";

export interface AnswerProposalInfoRequestResult {
  proposalId: string;
  infoRequestId: string;
  contributionId: string;
  proposalStatus: "SUBMITTED";
  recovered: boolean;
}

export async function answerProposalInfoRequestUseCase(
  command: AnswerProposalInfoRequestCommand,
  actorUserId: string,
): Promise<AnswerProposalInfoRequestResult> {
  const seed = buildAnswerSeed(command, actorUserId); // dominio: normaliza + valida
  const { io, getCommittedResult } = prismaAnswerInfoIO();

  try {
    await runMutation(answerProposalInfoRequest, seed, {
      ...io,
      actor: { type: "user", id: actorUserId },
      dryRun: false,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
    });
  } catch (err) {
    // Carrera cross-proposal: la misma key ganó el insert en OTRA propuesta.
    if (err instanceof ProposalAlreadyExistsError) {
      const existing = await io.read.findContributionByIdempotencyKey(seed.idempotencyKey);
      if (existing) {
        assertCompatibleAnswerReplay(seed, existing); // incompatible → IdempotencyConflictError
        return {
          proposalId: String(existing.proposalId),
          infoRequestId: String(seed.infoRequestId),
          contributionId: String(existing.id),
          proposalStatus: PROPOSAL_STATUS_SUBMITTED,
          recovered: true,
        };
      }
    }
    throw err;
  }

  const c = getCommittedResult();
  return {
    proposalId: String(c.proposalId),
    infoRequestId: String(c.infoRequestId),
    contributionId: String(c.contributionId),
    proposalStatus: PROPOSAL_STATUS_SUBMITTED,
    recovered: c.recovered,
  };
}
