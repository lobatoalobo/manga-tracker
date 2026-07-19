/**
 * Caso de uso "solicitar información": normaliza/valida el comando (dominio), corre la
 * mutación del framework (audit → MutationLog) y recupera el resultado. Idempotencia
 * autoritativa por `ProposalInfoRequest.idempotencyKey`: el replay bajo el lock lo
 * resuelve el write-port; una carrera cross-proposal por P2002 se reconcilia acá
 * (misma key en otra propuesta → conflicto). La auth/flag viven en la action.
 */
import {
  CompositeAuditSink,
  ConsoleAuditSink,
  runMutation,
} from "@/lib/mutations";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { prismaRequestInfoIO } from "@/lib/infra/proposal/requestInfo";
import { requestProposalInfo } from "@/lib/contributions/mutations/requestProposalInfo";
import {
  assertCompatibleInfoReplay,
  buildRequestInfoSeed,
  PROPOSAL_STATUS_NEEDS_INFO,
  type RequestProposalInfoCommand,
} from "@/lib/domain/proposal/requestInfo";

export {
  IdempotencyConflictError,
  OpenRequestExistsError,
  ProposalNotFoundError,
  ProposalNotRequestableError,
} from "@/lib/domain/proposal/requestInfo";

export interface RequestProposalInfoResult {
  proposalId: string;
  infoRequestId: string;
  proposalStatus: "NEEDS_INFO";
  recovered: boolean;
}

export async function requestProposalInfoUseCase(
  command: RequestProposalInfoCommand,
  actorUserId: string,
): Promise<RequestProposalInfoResult> {
  const seed = buildRequestInfoSeed(command, actorUserId); // dominio: normaliza + valida
  const { io, getCommittedResult } = prismaRequestInfoIO();

  try {
    await runMutation(requestProposalInfo, seed, {
      ...io,
      actor: { type: "admin", id: actorUserId },
      dryRun: false,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
    });
  } catch (err) {
    // Carrera cross-proposal: la misma key ganó el insert en OTRA propuesta.
    if (err instanceof ProposalAlreadyExistsError) {
      const existing = await io.read.findByIdempotencyKey(seed.idempotencyKey);
      if (existing) {
        // Distinta propuesta o payload → IdempotencyConflictError; si coincidiera, recuperar.
        assertCompatibleInfoReplay(seed, existing);
        return {
          proposalId: String(existing.proposalId),
          infoRequestId: String(existing.infoRequestId),
          proposalStatus: PROPOSAL_STATUS_NEEDS_INFO,
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
    proposalStatus: PROPOSAL_STATUS_NEEDS_INFO,
    recovered: c.recovered,
  };
}
