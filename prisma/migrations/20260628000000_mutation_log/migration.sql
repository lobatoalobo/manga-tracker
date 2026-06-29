-- Audit log del Mutation Framework. 1:1 con AuditEntry (schema CONGELADO v1).
-- Append-only; el correlationId conecta las fases de una corrida.
CREATE TABLE "MutationLog" (
    "id" SERIAL NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "frameworkVersion" INTEGER NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "requestId" TEXT,
    "dryRun" BOOLEAN NOT NULL,
    "creates" INTEGER,
    "updates" INTEGER,
    "deletes" INTEGER,
    "entities" TEXT[],
    "irreversible" BOOLEAN,
    "summaryDomain" TEXT,
    "summaryHuman" TEXT,
    "warnings" TEXT[],
    "mutationKey" TEXT,
    "mutationScope" TEXT,
    "durationMs" INTEGER,
    "errorName" TEXT,
    "errorMessage" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MutationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MutationLog_correlationId_idx" ON "MutationLog"("correlationId");
CREATE INDEX "MutationLog_name_at_idx" ON "MutationLog"("name", "at");
CREATE INDEX "MutationLog_mutationKey_idx" ON "MutationLog"("mutationKey");
