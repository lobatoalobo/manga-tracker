-- Collection — Slice 8: colección automática (ADR-010). Materializa las unidades retiradas en Retail
-- (evento PICKED_UP) en un modelo de posesión propio: Acquisition (hecho histórico inmutable/idempotente)
-- + OwnershipPosition (Aggregate Root de (userId, volumeId)).
--
-- NO APLICADA aún: base compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres EFÍMERO
-- de tests / staging, nunca desde scripts locales ni a producción (prod = checkpoint de deploy).
--
-- ADITIVO y seguro en caliente:
--   * `StoreOrderLineEvent.ownerUserIdSnapshot` (TEXT, nullable, SIN FK): snapshot estable del dueño al crear
--     un PICKED_UP → hace el hecho publicado autosuficiente (ADR-010 §D1.b). Como Slice 7 no está en prod, no
--     hay filas PICKED_UP previas: sin backfill ambiguo. Las líneas/eventos existentes quedan en NULL.
--   * Dos tablas nuevas con FKs a User (Cascade: borrar la cuenta elimina su colección) y Volume (Restrict).
--   * CHECKs de cantidad (Prisma no los expresa) por SQL manual, como 20260717000000_add_community_..._checks.

-- 1) Snapshot del dueño en el evento fuente (hardening del hecho publicado)
ALTER TABLE "StoreOrderLineEvent" ADD COLUMN "ownerUserIdSnapshot" TEXT;

-- 2) OwnershipPosition — posesión presente por (userId, volumeId)
CREATE TABLE "OwnershipPosition" (
  "id"        SERIAL       NOT NULL,
  "userId"    TEXT         NOT NULL,
  "volumeId"  INTEGER      NOT NULL,
  "quantity"  INTEGER      NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnershipPosition_pkey" PRIMARY KEY ("id")
);

-- 3) Acquisition — hecho histórico inmutable, ancla de idempotencia
CREATE TABLE "Acquisition" (
  "id"             SERIAL       NOT NULL,
  "acquisitionKey" TEXT         NOT NULL,
  "userId"         TEXT         NOT NULL,
  "volumeId"       INTEGER      NOT NULL,
  "quantity"       INTEGER      NOT NULL,
  "channel"        TEXT         NOT NULL,
  "occurredAt"     TIMESTAMP(3) NOT NULL,
  "recordedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Acquisition_pkey" PRIMARY KEY ("id")
);

-- Índices y unicidad
CREATE UNIQUE INDEX "OwnershipPosition_userId_volumeId_key" ON "OwnershipPosition" ("userId", "volumeId");
CREATE INDEX "OwnershipPosition_userId_idx" ON "OwnershipPosition" ("userId");
CREATE UNIQUE INDEX "Acquisition_acquisitionKey_key" ON "Acquisition" ("acquisitionKey");
CREATE INDEX "Acquisition_userId_volumeId_idx" ON "Acquisition" ("userId", "volumeId");

-- FKs. User: Cascade (borrar la cuenta elimina su colección). Volume: Restrict (no se borra un tomo con posesión).
ALTER TABLE "OwnershipPosition"
  ADD CONSTRAINT "OwnershipPosition_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "User" ("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "OwnershipPosition_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Acquisition"
  ADD CONSTRAINT "Acquisition_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "User" ("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "Acquisition_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs de dominio que Prisma no expresa: cantidades válidas.
ALTER TABLE "Acquisition"       ADD CONSTRAINT "Acquisition_quantity_positive"       CHECK ("quantity" > 0);
ALTER TABLE "OwnershipPosition" ADD CONSTRAINT "OwnershipPosition_quantity_nonneg"    CHECK ("quantity" >= 0);
