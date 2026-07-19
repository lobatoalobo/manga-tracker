/**
 * Infra: implementa el puerto de "resolver una propuesta" (lib/domain/proposal/resolve)
 * con Prisma. Escritura INDIVISIBLE bajo el lock de la propuesta (mismo orden que
 * RequestProposalInfo/AnswerProposalInfoRequest): lock → [replay: ResolutionRecord
 * existe → comparar huella] → validar SUBMITTED → validar sin request ABIERTO → leer
 * claims → validar cobertura → create ResolutionRecord → resolver cada claim PROPUESTA
 * → transición terminal + version++. NO toca el catálogo (Works/Editions/Volumes) ni
 * completa los campos applied/mutationCorrelationId (eso es ApplyCatalogProposal). Traduce P2002
 * (proposalId único) a `ProposalAlreadyExistsError`. Reusa el error de captura de
 * CreateProposal.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import { ProposalAlreadyExistsError } from "@/lib/domain/proposal/create";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import {
  assertClaimCoverage,
  assertCompatibleResolveReplay,
  ACTOR_TYPE_HUMAN,
  INFO_STATUS_OPEN,
  ProposalNotFoundError,
  ProposalNotResolvableError,
  PROPOSAL_STATUS_SUBMITTED,
  type ExistingResolution,
  type LockedProposalForResolve,
  type ProposalClaimRow,
  type ResolutionState,
  type ResolveOutcome,
  type ResolveReadPort,
  type ResolveWritePort,
} from "@/lib/domain/proposal/resolve";

type Db = Pick<
  Prisma.TransactionClient,
  "catalogProposal" | "proposalInfoRequest" | "proposalClaim" | "resolutionRecord"
>;

async function loadResolutionState(db: Db, proposalId: number): Promise<ResolutionState | null> {
  const rr = await db.resolutionRecord.findUnique({
    where: { proposalId },
    select: { id: true, outcome: true, publicReason: true, privateNote: true },
  });
  if (!rr) return null;
  const claims = await db.proposalClaim.findMany({
    where: { contribution: { proposalId } },
    select: { id: true, result: true, resultReason: true },
  });
  const resolution: ExistingResolution = {
    id: rr.id,
    outcome: rr.outcome,
    publicReason: rr.publicReason ?? null,
    privateNote: rr.privateNote ?? null,
  };
  return { resolution, claims: claims.map((c) => ({ id: c.id, result: c.result, resultReason: c.resultReason ?? null })) };
}

function readPort(db: Db): ResolveReadPort {
  return { loadResolutionState: (proposalId) => loadResolutionState(db, proposalId) };
}

export function resolveWritePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: ResolveOutcome) => void,
): ResolveWritePort {
  return {
    async resolve(seed) {
      // 1. Lock de la propuesta (mismo orden que los demás slices).
      const locked = await tx.$queryRaw<LockedProposalForResolve[]>(
        Prisma.sql`SELECT id, status, version FROM "CatalogProposal" WHERE id = ${seed.proposalId} FOR UPDATE`,
      );
      const proposal = locked[0];
      if (!proposal) throw new ProposalNotFoundError();

      // 2. Replay: ¿ya existe una resolución para esta propuesta? (ancla autoritativa).
      const existing = await loadResolutionState(tx, seed.proposalId);
      if (existing) {
        assertCompatibleResolveReplay(seed, existing.resolution, existing.claims); // incompatible → conflicto
        const out: ResolveOutcome = {
          proposalId: seed.proposalId,
          resolutionRecordId: existing.resolution.id,
          proposalStatus: seed.outcome,
          recovered: true,
        };
        onCommitted(out);
        return out;
      }

      // 3. Estado: solo se resuelve desde SUBMITTED.
      if (proposal.status !== PROPOSAL_STATUS_SUBMITTED)
        throw new ProposalNotResolvableError(proposal.status);

      // 4. No debe existir ningún InfoRequest ABIERTO (no se cierran acá).
      const open = await tx.proposalInfoRequest.findFirst({
        where: { proposalId: seed.proposalId, status: INFO_STATUS_OPEN },
        select: { id: true },
      });
      if (open) throw new ProposalNotResolvableError(proposal.status);

      // 5. Leer las claims de la propuesta.
      const claims: ProposalClaimRow[] = (
        await tx.proposalClaim.findMany({
          where: { contribution: { proposalId: seed.proposalId } },
          select: { id: true, result: true, resultReason: true },
        })
      ).map((c) => ({ id: c.id, result: c.result, resultReason: c.resultReason ?? null }));

      // 6. Cobertura: toda claim PROPUESTA cubierta exactamente una vez.
      assertClaimCoverage(seed.claimOutcomes, claims);

      // 7. Crear el ResolutionRecord (P2002 sobre proposalId único → AlreadyExists).
      let resolutionRecordId: number;
      try {
        const created = await tx.resolutionRecord.create({
          data: {
            proposalId: seed.proposalId,
            outcome: seed.outcome,
            actorType: ACTOR_TYPE_HUMAN,
            moderatorUserId: seed.moderatorUserId,
            publicReason: seed.publicReason,
            privateNote: seed.privateNote,
          },
          select: { id: true },
        });
        resolutionRecordId = created.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          String(err.meta?.target ?? "").includes("proposalId")
        )
          throw new ProposalAlreadyExistsError(String(seed.proposalId));
        throw err;
      }

      // 8. Resolver cada claim PROPUESTA (result + motivo + metadata de resolución).
      const now = new Date();
      for (const o of seed.claimOutcomes) {
        await tx.proposalClaim.update({
          where: { id: o.claimId },
          data: {
            result: o.result,
            resultReason: o.resultReason,
            resolvedAt: now,
            resolvedByUserId: seed.moderatorUserId,
          },
        });
      }

      // 9. Transición terminal + version++ (una vez).
      await tx.catalogProposal.update({
        where: { id: seed.proposalId },
        data: { status: seed.outcome, version: { increment: 1 } },
      });

      const out: ResolveOutcome = {
        proposalId: seed.proposalId,
        resolutionRecordId,
        proposalStatus: seed.outcome,
        recovered: false,
      };
      onCommitted(out);
      return out;
    },
  };
}

export interface ResolveIO {
  readonly io: Pick<RunOptions<ResolveReadPort, ResolveWritePort>, "read" | "transaction">;
  getCommittedResult(): ResolveOutcome;
}

export function prismaResolveIO(): ResolveIO {
  let committed: ResolveOutcome | null = null;
  const onCommitted = (r: ResolveOutcome) => {
    committed = { ...r };
  };
  return {
    io: {
      read: readPort(prisma),
      transaction: {
        run: (fn) =>
          prisma.$transaction(
            (tx) => fn({ read: readPort(tx), write: resolveWritePort(tx, onCommitted) }),
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
