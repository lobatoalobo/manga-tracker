-- Community Contributions — CHECK constraints (bucket G.1).
-- SEGUNDA migración, SOLO constraints; NO crea tablas/columnas/índices/uniques/FKs,
-- NO toca defaults ni datos. Complementa la estructural
-- 20260716000000_add_community_contributions_schema (inmutable).
-- Tablas vacías + sin código escribiendo → CHECK normal (no NOT VALID): valida al
-- instante contra 0 filas. Ver docs/community-contributions-first-migration-plan.md §G.1.

-- ----------------------------------------------------------------------------
-- CatalogProposal
-- ----------------------------------------------------------------------------
ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_family_check"
  CHECK ("family" IN ('ALTA','CORRECCION','REPORTE'));

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_targetKind_check"
  CHECK ("targetKind" IN ('NEW_WORK','NEW_EDITION','NEW_VOLUME','WORK','EDITION','VOLUME','STRUCTURAL'));

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_contentClass_check"
  CHECK ("contentClass" IN ('MANGA','COMIC'));

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_status_check"
  CHECK ("status" IN ('SUBMITTED','NEEDS_INFO','ACEPTADA','RECHAZADA','SUPERSEDED','ABANDONADA'));

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_relatedProposal_not_self_check"
  CHECK ("relatedProposalId" IS NULL OR "relatedProposalId" <> "id");

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_family_targetKind_check"
  CHECK (
    ("family" = 'ALTA'       AND "targetKind" IN ('NEW_WORK','NEW_EDITION','NEW_VOLUME'))
    OR ("family" = 'CORRECCION' AND "targetKind" IN ('WORK','EDITION','VOLUME'))
    OR ("family" = 'REPORTE'    AND "targetKind" = 'STRUCTURAL')
  );

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_target_columns_check"
  CHECK (
    CASE "targetKind"
      WHEN 'NEW_WORK'    THEN "refWorkId" IS NULL     AND "refEditionId" IS NULL AND "refVolumeId" IS NULL AND "relationKind" IS NULL AND "refWorkBId" IS NULL
      WHEN 'NEW_EDITION' THEN "refWorkId" IS NOT NULL AND "refEditionId" IS NULL AND "refVolumeId" IS NULL AND "relationKind" IS NULL AND "refWorkBId" IS NULL
      WHEN 'NEW_VOLUME'  THEN "refEditionId" IS NOT NULL AND "refWorkId" IS NULL AND "refVolumeId" IS NULL AND "relationKind" IS NULL AND "refWorkBId" IS NULL
      WHEN 'WORK'        THEN "refWorkId" IS NOT NULL AND "refEditionId" IS NULL AND "refVolumeId" IS NULL AND "relationKind" IS NULL AND "refWorkBId" IS NULL
      WHEN 'EDITION'     THEN "refEditionId" IS NOT NULL AND "refWorkId" IS NULL AND "refVolumeId" IS NULL AND "relationKind" IS NULL AND "refWorkBId" IS NULL
      WHEN 'VOLUME'      THEN "refVolumeId" IS NOT NULL AND "refWorkId" IS NULL AND "refEditionId" IS NULL AND "relationKind" IS NULL AND "refWorkBId" IS NULL
      WHEN 'STRUCTURAL'  THEN "relationKind" IS NOT NULL AND "refWorkId" IS NOT NULL AND "refEditionId" IS NULL AND "refVolumeId" IS NULL
      ELSE FALSE
    END
  );

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_relationKind_check"
  CHECK ("relationKind" IS NULL OR "relationKind" IN ('DUPLICATE','BAD_MERGE'));

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_duplicate_distinct_check"
  CHECK (
    "relationKind" IS DISTINCT FROM 'DUPLICATE'
    OR ("refWorkId" IS NOT NULL AND "refWorkBId" IS NOT NULL AND "refWorkId" <> "refWorkBId")
  );

ALTER TABLE "CatalogProposal" ADD CONSTRAINT "CatalogProposal_badmerge_no_bref_check"
  CHECK ("relationKind" IS DISTINCT FROM 'BAD_MERGE' OR "refWorkBId" IS NULL);

-- ----------------------------------------------------------------------------
-- ProposalContribution
-- ----------------------------------------------------------------------------
ALTER TABLE "ProposalContribution" ADD CONSTRAINT "ProposalContribution_visibility_check"
  CHECK ("visibility" IN ('VISIBLE','OCULTA','EN_CUARENTENA'));

-- ----------------------------------------------------------------------------
-- ProposalClaim
-- ----------------------------------------------------------------------------
ALTER TABLE "ProposalClaim" ADD CONSTRAINT "ProposalClaim_result_check"
  CHECK ("result" IN ('PROPUESTA','ACEPTADA','NO_USADA','RETIRADA'));

ALTER TABLE "ProposalClaim" ADD CONSTRAINT "ProposalClaim_claimOperation_check"
  CHECK ("claimOperation" IN ('SET','ADD','REMOVE','MARK_UNKNOWN','MARK_NOT_APPLICABLE'));

ALTER TABLE "ProposalClaim" ADD CONSTRAINT "ProposalClaim_markstar_value_null_check"
  CHECK ("claimOperation" NOT IN ('MARK_UNKNOWN','MARK_NOT_APPLICABLE') OR "value" IS NULL);

ALTER TABLE "ProposalClaim" ADD CONSTRAINT "ProposalClaim_valueop_value_present_check"
  CHECK ("claimOperation" IN ('MARK_UNKNOWN','MARK_NOT_APPLICABLE') OR "value" IS NOT NULL);

ALTER TABLE "ProposalClaim" ADD CONSTRAINT "ProposalClaim_result_reason_check"
  CHECK (
    ("result" = 'ACEPTADA' AND ("resultReason" IS NULL OR "resultReason" IN ('procedencia','corroboracion')))
    OR ("result" = 'NO_USADA' AND ("resultReason" IS NULL OR "resultReason" IN ('desplazada','descartada','rechazada')))
    OR ("result" IN ('PROPUESTA','RETIRADA') AND "resultReason" IS NULL)
  );

-- ----------------------------------------------------------------------------
-- ClaimEvidenceReference
-- ----------------------------------------------------------------------------
ALTER TABLE "ClaimEvidenceReference" ADD CONSTRAINT "ClaimEvidenceReference_type_check"
  CHECK ("type" IN ('URL','ISBN','SOURCE_REF'));

ALTER TABLE "ClaimEvidenceReference" ADD CONSTRAINT "ClaimEvidenceReference_strength_check"
  CHECK ("strength" IN ('STRONG','MEDIUM','WEAK'));

-- ----------------------------------------------------------------------------
-- ClaimEvidenceArtifact — SOLO el status estable (lifecycle → MVP-B)
-- ----------------------------------------------------------------------------
ALTER TABLE "ClaimEvidenceArtifact" ADD CONSTRAINT "ClaimEvidenceArtifact_status_check"
  CHECK ("status" IN ('EN_CUARENTENA','DISPONIBLE','BLOQUEADA'));

-- ----------------------------------------------------------------------------
-- ProposalInfoRequest
-- ----------------------------------------------------------------------------
ALTER TABLE "ProposalInfoRequest" ADD CONSTRAINT "ProposalInfoRequest_scope_check"
  CHECK ("scope" IN ('PROPOSAL','CONTRIBUTION'));

ALTER TABLE "ProposalInfoRequest" ADD CONSTRAINT "ProposalInfoRequest_status_check"
  CHECK ("status" IN ('ABIERTO','ANSWERED'));

ALTER TABLE "ProposalInfoRequest" ADD CONSTRAINT "ProposalInfoRequest_scope_target_check"
  CHECK ("scope" <> 'CONTRIBUTION' OR "targetContributionId" IS NOT NULL);

-- ----------------------------------------------------------------------------
-- ProposalSubscription
-- ----------------------------------------------------------------------------
ALTER TABLE "ProposalSubscription" ADD CONSTRAINT "ProposalSubscription_status_check"
  CHECK ("status" IN ('ACTIVE','CANCELLED'));

-- ----------------------------------------------------------------------------
-- ResolutionRecord
-- ----------------------------------------------------------------------------
ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_outcome_check"
  CHECK ("outcome" IN ('ACEPTADA','RECHAZADA','SUPERSEDED','ABANDONADA'));

ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_actorType_check"
  CHECK ("actorType" IN ('HUMAN','SYSTEM','RECONCILE'));

ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_human_moderator_check"
  CHECK ("actorType" <> 'HUMAN' OR "moderatorUserId" IS NOT NULL);

ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_superseded_reason_required_check"
  CHECK ("outcome" <> 'SUPERSEDED' OR "supersededReason" IS NOT NULL);

ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_supersededReason_valid_check"
  CHECK ("supersededReason" IS NULL OR "supersededReason" IN ('IMPORT','MODERATION','ANOTHER_PROPOSAL'));

-- ----------------------------------------------------------------------------
-- ProposalPreflightKey
-- ----------------------------------------------------------------------------
ALTER TABLE "ProposalPreflightKey" ADD CONSTRAINT "ProposalPreflightKey_keyType_check"
  CHECK ("keyType" IN ('NORM_TITLE','ROMAJI','ISBN','EXTERNAL'));
