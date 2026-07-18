/**
 * Caso de uso "agregar contribución": orquesta idempotencia (first-wins con
 * detección de conflicto sobre el set de claims) + la mutación del framework
 * (audit → MutationLog). Mismo patrón que CreateCatalogProposal. Autoritativa = el
 * unique `ProposalContribution.idempotencyKey`:
 *   - replay compatible (misma key, mismo set de claims)  → recupera la existente;
 *   - replay incompatible (misma key, claims distintas)    → IdempotencyConflictError.
 * El pre-chequeo por lectura NO revalida apertura de la propuesta (un replay legítimo
 * debe recuperar aunque la propuesta ya se haya cerrado después).
 */
import {
  CompositeAuditSink,
  ConsoleAuditSink,
  runMutation,
} from "@/lib/mutations";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { prismaAddContributionIO } from "@/lib/infra/proposal/addContribution";
import { addProposalContribution } from "@/lib/contributions/mutations/addProposalContribution";
import { IdempotencyConflictError, ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import {
  normalizeClaims,
  sameClaimSet,
  validateInputShape,
  type AddProposalContributionInput,
  type ExistingContribution,
} from "@/lib/domain/proposal/addContribution";

export { ProposalNotOpenError } from "@/lib/domain/proposal/addContribution";
export { IdempotencyConflictError } from "@/lib/domain/proposal/create";

export interface AddProposalContributionResult {
  proposalId: string;
  contributionId: string;
  recovered: boolean;
}

/** Replay: compara el set de claims; recupera si es compatible, si no lanza conflicto. */
function reconcile(
  input: AddProposalContributionInput,
  existing: ExistingContribution,
): AddProposalContributionResult {
  validateInputShape(input); // el input replayado debe ser bien formado
  const incoming = normalizeClaims(input.claims);
  if (!sameClaimSet(incoming, existing.claims))
    throw new IdempotencyConflictError(
      "La clave de idempotencia ya se usó para otra contribución distinta.",
    );
  return {
    proposalId: String(existing.proposalId),
    contributionId: String(existing.id),
    recovered: true,
  };
}

export async function addProposalContributionUseCase(
  input: AddProposalContributionInput,
  userId: string,
): Promise<AddProposalContributionResult> {
  const { io, getCommittedResult } = prismaAddContributionIO();

  // 1. Pre-chequeo de idempotencia (lectura; no revalida apertura de la propuesta).
  const existing = await io.read.findContributionByIdempotencyKey(input.createIdempotencyKey);
  if (existing) return reconcile(input, existing);

  // 2. Alta real vía el framework (audit a MutationLog).
  try {
    await runMutation(addProposalContribution, input, {
      ...io,
      actor: { type: "user", id: userId },
      dryRun: false,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
    });
  } catch (err) {
    // Carrera: otro request con la misma key ganó el insert entre el pre-chequeo y acá.
    if (err instanceof ProposalAlreadyExistsError) {
      const raced = await io.read.findContributionByIdempotencyKey(input.createIdempotencyKey);
      if (raced) return reconcile(input, raced);
    }
    throw err;
  }

  const committed = getCommittedResult();
  return {
    proposalId: String(committed.proposalId),
    contributionId: String(committed.contributionId),
    recovered: false,
  };
}
