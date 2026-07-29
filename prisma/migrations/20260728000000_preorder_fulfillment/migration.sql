-- Retail / Preventas — Slice 4: operación de proveedor y llegada por línea (cumplimiento).
-- NO APLICADA aún: la base es compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres
-- EFÍMERO de tests / staging, nunca desde scripts locales ni a producción.
--
-- Aditivo: agrega columnas de cumplimiento a `StoreOrderLine` (con defaults seguros para las filas
-- existentes) y crea la tabla inmutable `StoreOrderLineEvent`. `status`/`type` son TEXT (convención del
-- repo). Todas las FKs están modeladas en Prisma (sin drift). El catálogo no se toca.

-- 1) StoreOrderLine: contadores + estado operativo + fechas + auditoría de cancelación.
--    Defaults seguros: las líneas ya reservadas quedan en RESERVED con contadores en 0 (backfill implícito).
ALTER TABLE "StoreOrderLine"
  ADD COLUMN "fulfillmentStatus"  TEXT NOT NULL DEFAULT 'RESERVED',
  ADD COLUMN "orderedQuantity"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "arrivedQuantity"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelledQuantity"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "orderedAt"          TIMESTAMP(3),
  ADD COLUMN "arrivedAt"          TIMESTAMP(3),
  ADD COLUMN "cancelledAt"        TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId"  TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- `updatedAt` lo gestiona Prisma (@updatedAt, sin default en el schema): el DEFAULT sólo backfillea las filas
-- existentes; se quita para que schema y base no tengan drift.
ALTER TABLE "StoreOrderLine" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "StoreOrderLine_fulfillmentStatus_idx" ON "StoreOrderLine"("fulfillmentStatus");

ALTER TABLE "StoreOrderLine" ADD CONSTRAINT "StoreOrderLine_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) StoreOrderLineEvent: historial operativo inmutable. `operationKey` único = idempotencia de la operación.
CREATE TABLE "StoreOrderLineEvent" (
    "id"           SERIAL NOT NULL,
    "orderLineId"  INTEGER NOT NULL,
    "type"         TEXT NOT NULL,
    "quantity"     INTEGER NOT NULL,
    "actorUserId"  TEXT,
    "operationKey" TEXT NOT NULL,
    "note"         TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOrderLineEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreOrderLineEvent_operationKey_key" ON "StoreOrderLineEvent"("operationKey");
CREATE INDEX "StoreOrderLineEvent_orderLineId_createdAt_idx" ON "StoreOrderLineEvent"("orderLineId", "createdAt");
CREATE INDEX "StoreOrderLineEvent_actorUserId_idx" ON "StoreOrderLineEvent"("actorUserId");

-- Evento → Línea: Cascade (el evento vive con su línea; nunca se hard-deletea una orden confirmada por UI).
-- Actor → User: SetNull (preserva el historial si la cuenta se borra).
ALTER TABLE "StoreOrderLineEvent" ADD CONSTRAINT "StoreOrderLineEvent_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "StoreOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrderLineEvent" ADD CONSTRAINT "StoreOrderLineEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
