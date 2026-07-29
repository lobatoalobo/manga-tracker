-- Community Contributions — ProposalInfoRequest.idempotencyKey (idempotencia fuerte
-- del slice RequestProposalInfo). ADITIVA: columna nullable (compat con filas
-- históricas; múltiples NULL permitidos en Postgres) + índice UNIQUE global.
-- Sin DROP/RENAME/DML/backfill. Ver docs ADR-006.

-- AlterTable
ALTER TABLE "ProposalInfoRequest" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProposalInfoRequest_idempotencyKey_key" ON "ProposalInfoRequest"("idempotencyKey");
