/**
 * Infra: implementa el puerto de "aplicar propuesta" (lib/domain/proposal/apply) con
 * Prisma. Un solo write-port/mutación; despacha por `targetKind` tras el gate:
 * - NEW_WORK: build WorkDraft → dedup (id/título/romaji) → create Work → RR
 *   (appliedWorkId + primaryTitleClaimId).
 * - NEW_EDITION: valida Work padre (refWorkId) → build EditionDraft → deriva slug
 *   (`communityEditionSlug`) y normTitle → dedup (whakoomId, (publisher, slug)) →
 *   create PublisherEdition (url="") → RR (appliedEditionId).
 * - NEW_VOLUME: valida Edition padre (refEditionId) → build VolumeDraft → dedup
 *   ((editionId, number)) → create Volume → RR (appliedVolumeId).
 * Escritura INDIVISIBLE bajo el lock de la propuesta (mismo orden que los demás slices);
 * gate por `mutationCorrelationId`; create-only; NO cambia la propuesta; reusa helpers
 * puros de lib/catalog SIN modificarlo ni usar prisma global. P2002 → CatalogConflictError.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RunOptions } from "@/lib/mutations";
import { CommittedResultUnavailableError } from "@/lib/infra/proposal/create";
import { normalizeTitle, tightTitleKey, romajiKey, sameContentClass } from "@/lib/catalog";
import {
  buildWorkDraft,
  buildEditionDraft,
  buildVolumeDraft,
  communityEditionSlug,
  classifyApplyState,
  APPLY_TARGET_REFS,
  CatalogConflictError,
  InconsistentApplyStateError,
  ClaimSetInvalidError,
  ParentWorkNotFoundError,
  ParentEditionNotFoundError,
  ProposalNotApplicableError,
  ProposalNotFoundError,
  ResolutionNotFoundError,
  ResolutionNotPositiveError,
  TargetKindNotSupportedError,
  CLAIM_RESULT_ACCEPTED,
  CLAIM_RESULT_PROPOSED,
  PROPOSAL_STATUS_ACEPTADA,
  RESOLUTION_OUTCOME_ACEPTADA,
  TARGET_KIND_NEW_WORK,
  TARGET_KIND_NEW_EDITION,
  TARGET_KIND_NEW_VOLUME,
  type ApplyClaimRow,
  type ApplyOutcome,
  type ApplyReadPort,
  type ApplyWritePort,
  type EditionDraft,
  type ExistingResolutionForApply,
  type LockedProposalForApply,
  type WorkDraft,
} from "@/lib/domain/proposal/apply";

type Db = Pick<Prisma.TransactionClient, "resolutionRecord" | "proposalClaim" | "work" | "publisherEdition" | "volume">;

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

/**
 * Dedup de edición (create-only): (1) `whakoomId` unique, (2) `(publisher, slug)` — que
 * representa la identidad de dominio `(publisher, workId, language)` porque el slug la
 * codifica. Conflicto → throw. Usa el MISMO `slug` que el `create`.
 */
async function assertNoEditionConflict(db: Db, draft: EditionDraft, slug: string): Promise<void> {
  if (draft.whakoomId && (await db.publisherEdition.findUnique({ where: { whakoomId: draft.whakoomId }, select: { id: true } })))
    throw new CatalogConflictError("Ya existe una edición con ese whakoomId.");
  if (await db.publisherEdition.findUnique({ where: { publisher_slug: { publisher: draft.publisher, slug } }, select: { id: true } }))
    throw new CatalogConflictError("Ya existe una edición de comunidad para (publisher, work, language).");
}

export function applyWritePort(
  tx: Prisma.TransactionClient,
  onCommitted: (r: ApplyOutcome) => void,
): ApplyWritePort {
  return {
    async apply(seed, correlationId) {
      // 1. Lock de la propuesta (mismo orden que los demás slices).
      const locked = await tx.$queryRaw<LockedProposalForApply[]>(
        Prisma.sql`SELECT id, status, "targetKind", "contentClass", version, "refWorkId", "refEditionId" FROM "CatalogProposal" WHERE id = ${seed.proposalId} FOR UPDATE`,
      );
      const proposal = locked[0];
      if (!proposal) throw new ProposalNotFoundError();

      // 2. Elegibilidad. Las refs esperadas salen de la tabla-dato (targetKind sin
      //    entrada → no soportado).
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
        // Replay: echo genérico de las refs persistidas (target-agnóstico).
        const out: ApplyOutcome = {
          proposalId: seed.proposalId,
          resolutionRecordId: resolution.id,
          targetKind: proposal.targetKind,
          appliedWorkId: resolution.appliedWorkId,
          appliedEditionId: resolution.appliedEditionId,
          appliedVolumeId: resolution.appliedVolumeId,
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

      // 5. Dispatch por targetKind (una sola mutación; create-only).
      if (proposal.targetKind === TARGET_KIND_NEW_EDITION) {
        const out = await applyNewEdition(tx, seed.proposalId, resolution.id, proposal.refWorkId, accepted, correlationId);
        onCommitted(out);
        return out;
      }
      if (proposal.targetKind === TARGET_KIND_NEW_VOLUME) {
        const out = await applyNewVolume(tx, seed.proposalId, resolution.id, proposal.refEditionId, accepted, correlationId);
        onCommitted(out);
        return out;
      }

      // NEW_WORK (comportamiento existente, con outcome generalizado).
      const draft = buildWorkDraft(accepted, proposal.contentClass);
      await assertNoConflict(tx, draft); // create-only, sin fusión ni update
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
      await tx.resolutionRecord.update({
        where: { proposalId: seed.proposalId },
        data: { appliedWorkId, mutationCorrelationId: correlationId, primaryTitleClaimId: draft.primaryTitleClaimId },
      });
      const out: ApplyOutcome = {
        proposalId: seed.proposalId,
        resolutionRecordId: resolution.id,
        targetKind: TARGET_KIND_NEW_WORK,
        appliedWorkId,
        appliedEditionId: null,
        appliedVolumeId: null,
        mutationCorrelationId: correlationId,
        recovered: false,
      };
      onCommitted(out);
      return out;
    },
  };
}

/** Camino NEW_EDITION: valida Work padre, arma el draft, dedup, crea PublisherEdition y
 * actualiza el ResolutionRecord (appliedEditionId). NO toca la propuesta ni el Work padre. */
async function applyNewEdition(
  tx: Prisma.TransactionClient,
  proposalId: number,
  resolutionRecordId: number,
  refWorkId: number | null,
  accepted: ApplyClaimRow[],
  correlationId: string,
): Promise<ApplyOutcome> {
  if (refWorkId === null) throw new ParentWorkNotFoundError();
  const parent = await tx.work.findUnique({ where: { id: refWorkId }, select: { id: true, title: true } });
  if (!parent) throw new ParentWorkNotFoundError();

  const draft = buildEditionDraft(accepted, parent.title, parent.id);
  const slug = communityEditionSlug(draft.workId, draft.language);
  await assertNoEditionConflict(tx, draft, slug); // create-only, sin fusión ni update

  let appliedEditionId: number;
  try {
    const created = await tx.publisherEdition.create({
      data: {
        publisher: draft.publisher,
        slug,
        title: draft.title,
        normTitle: normalizeTitle(draft.title),
        volumes: draft.volumes,
        volumesLocked: draft.volumesLocked,
        url: "",
        language: draft.language,
        country: draft.country ?? undefined,
        status: draft.status ?? undefined,
        whakoomId: draft.whakoomId ?? undefined,
        workId: draft.workId,
      },
      select: { id: true },
    });
    appliedEditionId = created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      throw new CatalogConflictError("Colisión de identidad de edición al crear.");
    throw err;
  }

  await tx.resolutionRecord.update({
    where: { proposalId },
    data: { appliedEditionId, mutationCorrelationId: correlationId },
  });

  return {
    proposalId,
    resolutionRecordId,
    targetKind: TARGET_KIND_NEW_EDITION,
    appliedWorkId: null,
    appliedEditionId,
    appliedVolumeId: null,
    mutationCorrelationId: correlationId,
    recovered: false,
  };
}

/** Camino NEW_VOLUME: valida la edición padre, arma el draft, dedup por (editionId,
 * number), crea el Volume y actualiza el ResolutionRecord (appliedVolumeId). NO toca la
 * propuesta, el Work ni la edición padre. */
async function applyNewVolume(
  tx: Prisma.TransactionClient,
  proposalId: number,
  resolutionRecordId: number,
  refEditionId: number | null,
  accepted: ApplyClaimRow[],
  correlationId: string,
): Promise<ApplyOutcome> {
  if (refEditionId === null) throw new ParentEditionNotFoundError();
  const parent = await tx.publisherEdition.findUnique({ where: { id: refEditionId }, select: { id: true } });
  if (!parent) throw new ParentEditionNotFoundError();

  const draft = buildVolumeDraft(accepted, parent.id);

  // Dedup create-only: único pre-check por el unique compuesto (editionId, number).
  if (await tx.volume.findUnique({ where: { editionId_number: { editionId: draft.editionId, number: draft.number } }, select: { id: true } }))
    throw new CatalogConflictError("Ya existe un volumen con ese número en la edición.");

  let appliedVolumeId: number;
  try {
    const created = await tx.volume.create({
      data: {
        editionId: draft.editionId,
        number: draft.number,
        isbn: draft.isbn ?? undefined,
        whakoomComicId: draft.whakoomComicId ?? undefined,
      },
      select: { id: true },
    });
    appliedVolumeId = created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      throw new CatalogConflictError("Colisión de identidad de volumen al crear.");
    throw err;
  }

  await tx.resolutionRecord.update({
    where: { proposalId },
    data: { appliedVolumeId, mutationCorrelationId: correlationId },
  });

  return {
    proposalId,
    resolutionRecordId,
    targetKind: TARGET_KIND_NEW_VOLUME,
    appliedWorkId: null,
    appliedEditionId: null,
    appliedVolumeId,
    mutationCorrelationId: correlationId,
    recovered: false,
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
