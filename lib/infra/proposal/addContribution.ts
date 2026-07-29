/**
 * Infra: implementa los PUERTOS de "agregar contribución" (lib/domain/proposal/
 * addContribution) con Prisma. Único lugar que conoce Prisma para esta operación.
 * Reutiliza del slice CreateProposal: `CommittedResultUnavailableError` (mismo error
 * de captura) y `ProposalAlreadyExistsError` (traducción del unique P2002). La
 * captura del resultado queda encapsulada: `prismaAddContributionIO()` expone solo
 * `getCommittedResult`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import type {
  AddContributionReadPort,
  AddContributionWritePort,
} from "@/lib/domain/proposal/addContribution";

/** Resultado de dominio de la creación de la contribución (ids committeados). */
export interface CommittedContributionResult {
  readonly proposalId: number;
  readonly contributionId: number;
}

/** Holder write-once (mismo patrón que CreateProposal, shape propio del add). */
function createCommittedContributionResultHolder(): {
  set(v: CommittedContributionResult): void;
  get(): CommittedContributionResult;
} {
  let value: CommittedContributionResult | null = null;
  return {
    set(v) {
      value = { proposalId: v.proposalId, contributionId: v.contributionId };
    },
    get() {
      if (value === null) throw new CommittedResultUnavailableError();
      return Object.freeze({ ...value });
    },
  };
}

type DbRead = Pick<Prisma.TransactionClient, "catalogProposal" | "proposalContribution">;

function readPort(db: DbRead): AddContributionReadPort {
  return {
    async loadProposalForContribution(proposalId) {
      const p = await db.catalogProposal.findUnique({
        where: { id: proposalId },
        select: { id: true, status: true, contentClass: true, targetKind: true, family: true },
      });
      return p ?? null;
    },
    async findContributionByIdempotencyKey(key) {
      const c = await db.proposalContribution.findUnique({
        where: { idempotencyKey: key },
        select: {
          id: true,
          proposalId: true,
          claims: {
            select: {
              attributeKind: true, contractVersion: true, claimOperation: true, value: true,
            },
          },
        },
      });
      if (!c) return null;
      return {
        id: c.id,
        proposalId: c.proposalId,
        claims: c.claims.map((cl) => ({
          attributeKind: cl.attributeKind,
          contractVersion: cl.contractVersion,
          claimOperation: cl.claimOperation,
          value: cl.value ?? null,
        })),
      };
    },
  };
}

function writePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: CommittedContributionResult) => void,
): AddContributionWritePort {
  return {
    async insertContributionWithClaims(seed) {
      try {
        const created = await tx.proposalContribution.create({
          data: {
            proposalId: seed.proposalId,
            authorId: seed.authorId,
            idempotencyKey: seed.idempotencyKey,
            claims: {
              create: seed.claims.map((c) => ({
                attributeKind: c.attributeKind,
                contractVersion: c.contractVersion,
                claimOperation: c.claimOperation,
                // MARK_* ⇒ SQL NULL (lo exige el CHECK markstar_value_null);
                // SET/ADD/REMOVE ⇒ el value JSON.
                value:
                  c.value === null || c.value === undefined
                    ? Prisma.DbNull
                    : (c.value as Prisma.InputJsonValue),
                result: "PROPUESTA",
              })),
            },
          },
          select: { id: true, proposalId: true },
        });
        const result: CommittedContributionResult = {
          proposalId: created.proposalId,
          contributionId: created.id,
        };
        onCommitted(result);
        return result;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          String(err.meta?.target ?? "").includes("idempotencyKey")
        )
          throw new ProposalAlreadyExistsError(seed.idempotencyKey);
        throw err;
      }
    },
  };
}

export interface AddContributionIO {
  readonly io: Pick<
    RunOptions<AddContributionReadPort, AddContributionWritePort>,
    "read" | "transaction"
  >;
  getCommittedResult(): CommittedContributionResult;
}

/**
 * IO (read-port + transacción) para la mutación `addProposalContribution`. La
 * contribución y sus claims se crean en UNA tx (nested create). El estado de
 * captura es privado; solo se expone `getCommittedResult`.
 */
export function prismaAddContributionIO(): AddContributionIO {
  const holder = createCommittedContributionResultHolder();
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
