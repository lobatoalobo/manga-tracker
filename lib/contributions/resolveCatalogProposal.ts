/**
 * Caso de uso "resolver una propuesta": normaliza/valida (dominio), corre la mutación
 * (audit → MutationLog) y recupera el resultado. Este slice SOLO decide y registra: NO
 * aplica al catálogo (`appliedToCatalog: false` siempre). Idempotencia autoritativa por
 * la unicidad de `ResolutionRecord.proposalId`: el replay bajo el lock lo resuelve el
 * write-port; una carrera por P2002 se reconcilia acá (misma resolución → recuperar;
 * distinta → conflicto). La auth (flag + sesión + admin) vive en la action.
 */
import {
  CompositeAuditSink,
  ConsoleAuditSink,
  runMutation,
} from "@/lib/mutations";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { prismaResolveIO } from "@/lib/infra/proposal/resolve";
import { resolveCatalogProposal } from "@/lib/contributions/mutations/resolveCatalogProposal";
import {
  assertCompatibleResolveReplay,
  buildResolveSeed,
  type ResolveCatalogProposalCommand,
  type ResolveOutcomeKind,
} from "@/lib/domain/proposal/resolve";

export {
  IdempotencyConflictError,
  ProposalNotFoundError,
  ProposalNotResolvableError,
  ClaimOutcomesInvalidError,
} from "@/lib/domain/proposal/resolve";

export interface ResolveCatalogProposalResult {
  proposalId: string;
  resolutionRecordId: string;
  proposalStatus: ResolveOutcomeKind;
  appliedToCatalog: false;
  recovered: boolean;
}

export async function resolveCatalogProposalUseCase(
  command: ResolveCatalogProposalCommand,
  moderatorUserId: string,
): Promise<ResolveCatalogProposalResult> {
  const seed = buildResolveSeed(command, moderatorUserId); // dominio: normaliza + valida
  const { io, getCommittedResult } = prismaResolveIO();

  try {
    await runMutation(resolveCatalogProposal, seed, {
      ...io,
      actor: { type: "admin", id: moderatorUserId },
      dryRun: false,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
    });
  } catch (err) {
    // Carrera: la resolución ganó el insert (proposalId único). Reconciliar por payload.
    if (err instanceof ProposalAlreadyExistsError) {
      const existing = await io.read.loadResolutionState(seed.proposalId);
      if (existing) {
        assertCompatibleResolveReplay(seed, existing.resolution, existing.claims); // incompatible → conflicto
        return {
          proposalId: String(seed.proposalId),
          resolutionRecordId: String(existing.resolution.id),
          proposalStatus: seed.outcome,
          appliedToCatalog: false,
          recovered: true,
        };
      }
    }
    throw err;
  }

  const c = getCommittedResult();
  return {
    proposalId: String(c.proposalId),
    resolutionRecordId: String(c.resolutionRecordId),
    proposalStatus: c.proposalStatus,
    appliedToCatalog: false,
    recovered: c.recovered,
  };
}
