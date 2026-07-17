-- AlterTable
ALTER TABLE "NotificationPref" ADD COLUMN     "contributions" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CatalogProposal" (
    "id" SERIAL NOT NULL,
    "family" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "refWorkId" INTEGER,
    "refEditionId" INTEGER,
    "refVolumeId" INTEGER,
    "refWorkBId" INTEGER,
    "relationKind" TEXT,
    "contentClass" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "relatedProposalId" INTEGER,
    "originatorUserId" TEXT,
    "createIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalContribution" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "authorId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'VISIBLE',
    "withdrawnAt" TIMESTAMP(3),
    "answersInfoRequestId" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalClaim" (
    "id" SERIAL NOT NULL,
    "contributionId" INTEGER NOT NULL,
    "attributeKind" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "claimOperation" TEXT NOT NULL,
    "value" JSONB,
    "result" TEXT NOT NULL DEFAULT 'PROPUESTA',
    "resultReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "promotedAssetRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidenceReference" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidenceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidenceArtifact" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EN_CUARENTENA',
    "storageKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "detectedMime" TEXT,
    "sizeBytes" INTEGER,
    "scanResult" TEXT,
    "blockedReason" TEXT,
    "scheduledDeleteAt" TIMESTAMP(3),
    "bytesDeletedAt" TIMESTAMP(3),
    "promotedAssetRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimEvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalInfoRequest" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetContributionId" INTEGER,
    "prompt" TEXT NOT NULL,
    "privateNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABIERTO',
    "openedByUserId" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalInfoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalSubscription" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionRecord" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "moderatorUserId" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicReason" TEXT,
    "privateNote" TEXT,
    "appliedWorkId" INTEGER,
    "appliedEditionId" INTEGER,
    "appliedVolumeId" INTEGER,
    "supersedingProposalId" INTEGER,
    "supersededReason" TEXT,
    "mutationCorrelationId" TEXT,
    "overrideSummary" JSONB,
    "primaryTitleClaimId" INTEGER,
    "reconcileMeta" JSONB,

    CONSTRAINT "ResolutionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalPreflightKey" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyValue" TEXT NOT NULL,

    CONSTRAINT "ProposalPreflightKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProposal_createIdempotencyKey_key" ON "CatalogProposal"("createIdempotencyKey");

-- CreateIndex
CREATE INDEX "CatalogProposal_status_idx" ON "CatalogProposal"("status");

-- CreateIndex
CREATE INDEX "CatalogProposal_originatorUserId_idx" ON "CatalogProposal"("originatorUserId");

-- CreateIndex
CREATE INDEX "CatalogProposal_contentClass_idx" ON "CatalogProposal"("contentClass");

-- CreateIndex
CREATE INDEX "CatalogProposal_refWorkId_idx" ON "CatalogProposal"("refWorkId");

-- CreateIndex
CREATE INDEX "CatalogProposal_refEditionId_idx" ON "CatalogProposal"("refEditionId");

-- CreateIndex
CREATE INDEX "CatalogProposal_refVolumeId_idx" ON "CatalogProposal"("refVolumeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalContribution_idempotencyKey_key" ON "ProposalContribution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProposalContribution_proposalId_createdAt_idx" ON "ProposalContribution"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalContribution_authorId_idx" ON "ProposalContribution"("authorId");

-- CreateIndex
CREATE INDEX "ProposalContribution_answersInfoRequestId_idx" ON "ProposalContribution"("answersInfoRequestId");

-- CreateIndex
CREATE INDEX "ProposalClaim_contributionId_result_idx" ON "ProposalClaim"("contributionId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidenceReference_claimId_type_value_key" ON "ClaimEvidenceReference"("claimId", "type", "value");

-- CreateIndex
CREATE INDEX "ClaimEvidenceArtifact_status_idx" ON "ClaimEvidenceArtifact"("status");

-- CreateIndex
CREATE INDEX "ClaimEvidenceArtifact_scheduledDeleteAt_idx" ON "ClaimEvidenceArtifact"("scheduledDeleteAt");

-- CreateIndex
CREATE INDEX "ProposalInfoRequest_proposalId_status_idx" ON "ProposalInfoRequest"("proposalId", "status");

-- CreateIndex
CREATE INDEX "ProposalSubscription_proposalId_status_idx" ON "ProposalSubscription"("proposalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSubscription_userId_proposalId_key" ON "ProposalSubscription"("userId", "proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionRecord_proposalId_key" ON "ResolutionRecord"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalPreflightKey_keyType_keyValue_idx" ON "ProposalPreflightKey"("keyType", "keyValue");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalPreflightKey_proposalId_keyType_keyValue_key" ON "ProposalPreflightKey"("proposalId", "keyType", "keyValue");

-- AddForeignKey
ALTER TABLE "ProposalContribution" ADD CONSTRAINT "ProposalContribution_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CatalogProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalContribution" ADD CONSTRAINT "ProposalContribution_answersInfoRequestId_fkey" FOREIGN KEY ("answersInfoRequestId") REFERENCES "ProposalInfoRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalClaim" ADD CONSTRAINT "ProposalClaim_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "ProposalContribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceReference" ADD CONSTRAINT "ClaimEvidenceReference_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ProposalClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceArtifact" ADD CONSTRAINT "ClaimEvidenceArtifact_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ProposalClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalInfoRequest" ADD CONSTRAINT "ProposalInfoRequest_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CatalogProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalSubscription" ADD CONSTRAINT "ProposalSubscription_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CatalogProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CatalogProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalPreflightKey" ADD CONSTRAINT "ProposalPreflightKey_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CatalogProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

