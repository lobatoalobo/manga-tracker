/**
 * Caso de uso "aplicar propuesta al catálogo" (vertical NEW_WORK): normaliza/valida el
 * comando (dominio), corre la mutación (audit → MutationLog) y recupera el resultado.
 * Este slice SOLO aplica NEW_WORK: crea un Work y rellena las refs de aplicación del
 * ResolutionRecord; `appliedEditionId`/`appliedVolumeId` son SIEMPRE null. Idempotencia
 * fuerte por `ResolutionRecord.mutationCorrelationId` (gate bajo lock en el write-port);
 * NO hay recuperación por P2002 (Apply no inserta una idempotency key; un P2002 del Work
 * es `CatalogConflictError`). La auth (flag + sesión + admin) vive en la action.
 */
import {
  CompositeAuditSink,
  ConsoleAuditSink,
  runMutation,
} from "@/lib/mutations";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { prismaApplyIO } from "@/lib/infra/proposal/apply";
import { applyCatalogProposal } from "@/lib/contributions/mutations/applyCatalogProposal";
import {
  buildApplySeed,
  TARGET_KIND_NEW_WORK,
  type ApplyCatalogProposalCommand,
} from "@/lib/domain/proposal/apply";

export {
  ProposalNotFoundError,
  ProposalNotApplicableError,
  ResolutionNotFoundError,
  ResolutionNotPositiveError,
  NoApplicableClaimsError,
  ClaimSetInvalidError,
  TargetKindNotSupportedError,
  InsufficientCatalogDataError,
  CatalogConflictError,
  InconsistentApplyStateError,
  UnsupportedClaimForApplyError,
} from "@/lib/domain/proposal/apply";

export interface ApplyCatalogProposalResult {
  proposalId: string;
  resolutionRecordId: string;
  targetKind: "NEW_WORK";
  appliedWorkId: string;
  appliedEditionId: null;
  appliedVolumeId: null;
  mutationCorrelationId: string;
  recovered: boolean;
}

export async function applyCatalogProposalUseCase(
  command: ApplyCatalogProposalCommand,
  actorUserId: string,
): Promise<ApplyCatalogProposalResult> {
  const seed = buildApplySeed(command); // dominio: normaliza + valida
  const { io, getCommittedResult } = prismaApplyIO();

  await runMutation(applyCatalogProposal, seed, {
    ...io,
    actor: { type: "admin", id: actorUserId },
    dryRun: false,
    audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
  });

  const c = getCommittedResult();
  return {
    proposalId: String(c.proposalId),
    resolutionRecordId: String(c.resolutionRecordId),
    targetKind: TARGET_KIND_NEW_WORK,
    appliedWorkId: String(c.appliedWorkId),
    appliedEditionId: null,
    appliedVolumeId: null,
    mutationCorrelationId: c.mutationCorrelationId,
    recovered: c.recovered,
  };
}
