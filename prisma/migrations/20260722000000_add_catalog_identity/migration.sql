-- Slice "Conferir una Identity" — subsistema de identidad (handle propio del catálogo).
-- NO APLICADA aún: la base es compartida/gated (ver memoria del proyecto). Se aplica con
-- `prisma migrate deploy` sobre staging/base desechable, nunca desde scripts locales.
-- El índice PARCIAL de designación única (WHERE state='ACTIVE') es SQL crudo: Prisma no lo
-- expresa en el DSL. Enforcea el invariante global de designación única entre identidades ACTIVE.

-- CreateTable
CREATE TABLE "CatalogIdentity" (
    "id" SERIAL NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contentClass" TEXT NOT NULL,
    "designatedWorkId" INTEGER NOT NULL,
    "decisionId" TEXT NOT NULL,
    "decisionFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityExternalReference" (
    "id" SERIAL NOT NULL,
    "identityId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityExternalReference_pkey" PRIMARY KEY ("id")
);

-- Idempotencia + auditoría: una Decisión confiere a lo sumo una Identity.
CREATE UNIQUE INDEX "CatalogIdentity_decisionId_key" ON "CatalogIdentity"("decisionId");

-- Índice de apoyo para lookups por contenido.
CREATE INDEX "CatalogIdentity_designatedWorkId_idx" ON "CatalogIdentity"("designatedWorkId");

-- Designación única: a lo sumo UNA identidad ACTIVE por contenido (índice parcial).
CREATE UNIQUE INDEX "CatalogIdentity_designatedWorkId_active_key" ON "CatalogIdentity"("designatedWorkId") WHERE "state" = 'ACTIVE';

-- Unicidad de referencia: una referencia externa resuelve a lo sumo hacia una identidad.
CREATE UNIQUE INDEX "IdentityExternalReference_provider_externalId_key" ON "IdentityExternalReference"("provider", "externalId");

-- Índice de apoyo para navegar las referencias de una identidad.
CREATE INDEX "IdentityExternalReference_identityId_idx" ON "IdentityExternalReference"("identityId");

-- FKs
ALTER TABLE "CatalogIdentity" ADD CONSTRAINT "CatalogIdentity_designatedWorkId_fkey" FOREIGN KEY ("designatedWorkId") REFERENCES "Work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityExternalReference" ADD CONSTRAINT "IdentityExternalReference_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "CatalogIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
