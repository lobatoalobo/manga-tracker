/**
 * Infra: implementa el puerto de "aplicar propuesta" (lib/domain/proposal/apply) con
 * Prisma, vertical NEW_WORK. Escritura INDIVISIBLE bajo el lock de la propuesta (mismo
 * orden que Resolve/RequestInfo/AnswerInfo): lock → leer ResolutionRecord → gate
 * (mutationCorrelationId) → [APPLIED: replay] → validar elegibilidad → leer claims →
 * build draft (dominio) → dedup tx-bound (reusa normalizeTitle/tightTitleKey/romajiKey/
 * sameContentClass de lib/catalog, SIN modificarlo, SIN prisma global) → create Work →
 * update único del ResolutionRecord (appliedWorkId + mutationCorrelationId +
 * primaryTitleClaimId) EN LA MISMA TX. NO crea Edition/Volume. NO cambia la propuesta.
 * P2002 por identidad externa → CatalogConflictError. Reusa el error de captura de
 * CreateProposal.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import { normalizeTitle, tightTitleKey, romajiKey, sameContentClass } from "@/lib/catalog";
import {
  buildWorkDraft,
  classifyApplyState,
  APPLY_TARGET_REFS,
  CatalogConflictError,
  InconsistentApplyStateError,
  ClaimSetInvalidError,
  ProposalNotApplicableError,
  ProposalNotFoundError,
  ResolutionNotFoundError,
  ResolutionNotPositiveError,
  TargetKindNotSupportedError,
  CLAIM_RESULT_ACCEPTED,
  CLAIM_RESULT_PROPOSED,
  PROPOSAL_STATUS_ACEPTADA,
  RESOLUTION_OUTCOME_ACEPTADA,
  type ApplyClaimRow,
  type ApplyOutcome,
  type ApplyReadPort,
  type ApplyWritePort,
  type ExistingResolutionForApply,
  type LockedProposalForApply,
  type WorkDraft,
} from "@/lib/domain/proposal/apply";

type Db = Pick<Prisma.TransactionClient, "resolutionRecord" | "proposalClaim" | "work">;

async function loadResolution(db: Db, proposalId: number): Promise<ExistingResolutionForApply | null> {
  const r = await db.resolutionRecord.findUnique({
    where: { proposalId },
    select: { id: true, outcome: true, mutationCorrelationId: true, appliedWorkId: true, appliedEditionId: true, appliedVolumeId: true },
  });
  return r
    ? {
        id: r.id, outcome: r.outcome, mutationCorrelationId: r.mutationCorrelationId ?? null,
        appliedWorkId: r.appliedWorkId ?? null, appliedEditionId: r.appliedEditionId ?? null, appliedVolumeId: r.appliedVolumeId ?? null,
      }
    : null;
}

/** Dedup tx-bound (id-first → título/contentClass → puente romaji). Conflicto → throw. */
async function assertNoConflict(db: Db, draft: WorkDraft): Promise<void> {
  if (draft.anilistId !== null && (await db.work.findUnique({ where: { anilistId: draft.anilistId }, select: { id: true } })))
    throw new CatalogConflictError("Ya existe un Work con ese anilistId.");
  if (draft.muId && (await db.work.findUnique({ where: { muId: draft.muId }, select: { id: true } })))
    throw new CatalogConflictError("Ya existe un Work con ese muId.");
  if (draft.mdId && (await db.work.findUnique({ where: { mdId: draft.mdId }, select: { id: true } })))
    throw new CatalogConflictError("Ya existe un Work con ese mdId.");

  const normTitle = normalizeTitle(draft.title);
  const tight = tightTitleKey(draft.title);
  const byTitle = await db.work.findMany({ where: { normTitle }, select: { id: true, title: true, type: true } });
  if (byTitle.some((w) => tightTitleKey(w.title) === tight && sameContentClass(draft.incomingType, w.type)))
    throw new CatalogConflictError("Ya existe un Work con el mismo título y clase de contenido.");

  if (draft.originalTitle) {
    const core = draft.originalTitle.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const rk = romajiKey(draft.originalTitle);
    if (rk.length >= 4) {
      const byRomaji = await db.work.findMany({
        where: { originalTitle: { contains: core, mode: "insensitive" } },
        select: { id: true, originalTitle: true, type: true },
      });
      if (byRomaji.some((w) => w.originalTitle && romajiKey(w.originalTitle) === rk && sameContentClass(draft.incomingType, w.type)))
        throw new CatalogConflictError("Ya existe un Work con el mismo romaji y clase de contenido.");
    }
  }
}

export function applyWritePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: ApplyOutcome) => void,
): ApplyWritePort {
  return {
    async apply(seed, correlationId) {
      // 1. Lock de la propuesta (mismo orden que los demás slices).
      const locked = await tx.$queryRaw<LockedProposalForApply[]>(
        Prisma.sql`SELECT id, status, "targetKind", "contentClass", version FROM "CatalogProposal" WHERE id = ${seed.proposalId} FOR UPDATE`,
      );
      const proposal = locked[0];
      if (!proposal) throw new ProposalNotFoundError();

      // 2. Elegibilidad de la propuesta. Las refs esperadas salen de la tabla-dato
      //    (targetKind sin entrada → no soportado); este vertical solo cubre NEW_WORK.
      const expectedRefs = APPLY_TARGET_REFS[proposal.targetKind];
      if (!expectedRefs) throw new TargetKindNotSupportedError(proposal.targetKind);
      if (proposal.status !== PROPOSAL_STATUS_ACEPTADA) throw new ProposalNotApplicableError(proposal.status);

      // 3. ResolutionRecord + gate de idempotencia (parametrizado por refs esperadas).
      const resolution = await loadResolution(tx, seed.proposalId);
      if (!resolution) throw new ResolutionNotFoundError();
      if (resolution.outcome !== RESOLUTION_OUTCOME_ACEPTADA) throw new ResolutionNotPositiveError(resolution.outcome);

      const state = classifyApplyState(resolution, expectedRefs);
      if (state === "INCONSISTENT") throw new InconsistentApplyStateError();
      if (state === "APPLIED") {
        const out: ApplyOutcome = {
          proposalId: seed.proposalId,
          resolutionRecordId: resolution.id,
          appliedWorkId: resolution.appliedWorkId!,
          mutationCorrelationId: resolution.mutationCorrelationId!,
          recovered: true,
        };
        onCommitted(out);
        return out;
      }

      // 4. Claims: no debe quedar ninguna PROPUESTA; tomar solo ACEPTADA.
      const claims = (await tx.proposalClaim.findMany({
        where: { contribution: { proposalId: seed.proposalId } },
        select: { id: true, attributeKind: true, value: true, result: true },
      })).map<ApplyClaimRow>((c) => ({ id: c.id, attributeKind: c.attributeKind, value: c.value ?? null, result: c.result }));
      if (claims.some((c) => c.result === CLAIM_RESULT_PROPOSED))
        throw new ClaimSetInvalidError("Quedan claims sin resolver (PROPUESTA).");
      const accepted = claims.filter((c) => c.result === CLAIM_RESULT_ACCEPTED);

      // 5. Draft determinista (dominio; valida soporte/cardinalidad/título).
      const draft = buildWorkDraft(accepted, proposal.contentClass);

      // 6. Dedup tx-bound → conflicto = error (create-only, sin fusión ni update).
      await assertNoConflict(tx, draft);

      // 7. Crear exactamente un Work.
      let appliedWorkId: number;
      try {
        const created = await tx.work.create({
          data: {
            title: draft.title,
            normTitle: normalizeTitle(draft.title),
            type: draft.type,
            upcoming: true,
            curated: draft.curated,
            originalTitle: draft.originalTitle ?? undefined,
            titleNative: draft.titleNative ?? undefined,
            titleEn: draft.titleEn ?? undefined,
            author: draft.author ?? undefined,
            synopsisEs: draft.synopsisEs ?? undefined,
            synopsisEn: draft.synopsisEn ?? undefined,
            anilistId: draft.anilistId ?? undefined,
            muId: draft.muId ?? undefined,
            mdId: draft.mdId ?? undefined,
          },
          select: { id: true },
        });
        appliedWorkId = created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
          throw new CatalogConflictError("Colisión de identidad externa al crear el Work.");
        throw err;
      }

      // 8. Update único del ResolutionRecord (misma tx). NO toca la propuesta.
      await tx.resolutionRecord.update({
        where: { proposalId: seed.proposalId },
        data: {
          appliedWorkId,
          mutationCorrelationId: correlationId,
          primaryTitleClaimId: draft.primaryTitleClaimId,
        },
      });

      const out: ApplyOutcome = {
        proposalId: seed.proposalId,
        resolutionRecordId: resolution.id,
        appliedWorkId,
        mutationCorrelationId: correlationId,
        recovered: false,
      };
      onCommitted(out);
      return out;
    },
  };
}

export interface ApplyIO {
  readonly io: Pick<RunOptions<ApplyReadPort, ApplyWritePort>, "read" | "transaction">;
  getCommittedResult(): ApplyOutcome;
}

export function prismaApplyIO(): ApplyIO {
  let committed: ApplyOutcome | null = null;
  const onCommitted = (r: ApplyOutcome) => {
    committed = { ...r };
  };
  const read: ApplyReadPort = {};
  return {
    io: {
      read,
      transaction: {
        run: (fn) =>
          prisma.$transaction((tx) => fn({ read, write: applyWritePort(tx, onCommitted) }), { timeout: 15000 }),
      },
    },
    getCommittedResult() {
      if (committed === null) throw new CommittedResultUnavailableError();
      return Object.freeze({ ...committed });
    },
  };
}
