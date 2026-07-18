/**
 * Caso de uso "crear propuesta de catálogo": orquesta idempotencia (first-wins con
 * detección de conflicto) + la mutación del framework (audit → MutationLog). La
 * clave autoritativa es el unique `CatalogProposal.createIdempotencyKey`:
 *   - replay compatible (misma key, misma huella)  → recupera la propuesta existente;
 *   - replay incompatible (misma key, huella distinta) → IdempotencyConflictError.
 * Se pre-chequea por lectura (el replay normal no re-ejecuta la mutación); una
 * carrera concurrente se resuelve por el P2002 → reconciliación.
 */
import {
  CompositeAuditSink,
  ConsoleAuditSink,
  runMutation,
} from "@/lib/mutations";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { prismaCreateProposalIO } from "@/lib/infra/proposal/create";
import { createCatalogProposal } from "@/lib/contributions/mutations/createCatalogProposal";
import {
  assertCompatibleReplay,
  resolveSeed,
  ProposalAlreadyExistsError,
  type CatalogProposalStatus,
  type CreateCatalogProposalInput,
  type ExistingProposal,
} from "@/lib/domain/proposal/create";

export { IdempotencyConflictError } from "@/lib/domain/proposal/create";

export interface CreateCatalogProposalResult {
  proposalId: string;
  contributionId: string;
  status: CatalogProposalStatus;
  recovered: boolean;
}

function recovered(existing: ExistingProposal): CreateCatalogProposalResult {
  return {
    proposalId: String(existing.id),
    contributionId:
      existing.originatingContributionId != null
        ? String(existing.originatingContributionId)
        : "",
    status: existing.status as CatalogProposalStatus,
    recovered: true,
  };
}

/**
 * Crea la propuesta + su contribución originadora para `userId` (originator y actor).
 * Idempotente por `input.createIdempotencyKey`.
 */
export async function createCatalogProposalUseCase(
  input: CreateCatalogProposalInput,
  userId: string,
): Promise<CreateCatalogProposalResult> {
  const { io, getCommittedResult } = prismaCreateProposalIO();

  // 1. Pre-chequeo de idempotencia (lectura; el replay normal no re-ejecuta).
  const existing = await io.read.findByIdempotencyKey(input.createIdempotencyKey);
  if (existing) {
    const seed = await resolveSeed(io.read, input, userId); // valida + deriva contentClass
    assertCompatibleReplay(seed, existing); // conflicto → IdempotencyConflictError
    return recovered(existing);
  }

  // 2. Alta real vía el framework (audit a MutationLog).
  try {
    await runMutation(createCatalogProposal, input, {
      ...io,
      actor: { type: "user", id: userId },
      dryRun: false,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
    });
  } catch (err) {
    // Carrera: otro request con la misma key ganó el insert entre el pre-chequeo y acá.
    if (err instanceof ProposalAlreadyExistsError) {
      const raced = await io.read.findByIdempotencyKey(input.createIdempotencyKey);
      if (raced) {
        const seed = await resolveSeed(io.read, input, userId);
        assertCompatibleReplay(seed, raced);
        return recovered(raced);
      }
    }
    throw err;
  }

  // Resultado capturado por el adapter durante la tx (getter explícito; lanza
  // CommittedResultUnavailableError si execute no llegó a capturar).
  const committed = getCommittedResult();
  return {
    proposalId: String(committed.proposalId),
    contributionId: String(committed.contributionId),
    status: committed.status as CatalogProposalStatus,
    recovered: false,
  };
}
