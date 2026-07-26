-- Retail / Preventas — Slice 6: pagos manuales (StorePayment).
-- NO APLICADA aún: la base es compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres
-- EFÍMERO de tests / staging, nunca desde scripts locales ni a producción.
--
-- Aditivo: crea la tabla StorePayment (ledger append-only) y agrega a StoreOrder la proyección de pago
-- (`paidCents`, `paymentStatus`). Los defaults (0 / 'UNPAID') dejan las órdenes existentes correctas sin
-- backfill (no tienen pagos). `status`/`method` son TEXT (convención del repo). Todas las FKs están
-- modeladas en Prisma (sin drift). El pago NO modifica contadores de fulfillment ni el catálogo.

-- Proyección de pago en StoreOrder (derivada del ledger; recomputada transaccionalmente).
ALTER TABLE "StoreOrder" ADD COLUMN "paidCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreOrder" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID';

CREATE TABLE "StorePayment" (
    "id"                 SERIAL NOT NULL,
    "orderId"            INTEGER NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'CONFIRMED',
    "amountCents"        INTEGER NOT NULL,
    "method"             TEXT NOT NULL,
    "note"               TEXT,
    "paidAt"             TIMESTAMP(3) NOT NULL,
    "confirmedByUserId"  TEXT,
    "recordOperationKey" TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePayment_pkey" PRIMARY KEY ("id")
);

-- `updatedAt` lo gestiona Prisma (@updatedAt, sin default en el schema); tabla nueva/vacía, sin backfill.
CREATE UNIQUE INDEX "StorePayment_recordOperationKey_key" ON "StorePayment"("recordOperationKey");
CREATE INDEX "StorePayment_orderId_idx" ON "StorePayment"("orderId");
CREATE INDEX "StorePayment_status_idx" ON "StorePayment"("status");
CREATE INDEX "StorePayment_method_idx" ON "StorePayment"("method");
CREATE INDEX "StorePayment_paidAt_idx" ON "StorePayment"("paidAt");
CREATE INDEX "StorePayment_createdAt_idx" ON "StorePayment"("createdAt");

-- Índices de la proyección para tableros de pago.
CREATE INDEX "StoreOrder_paymentStatus_idx" ON "StoreOrder"("paymentStatus");
CREATE INDEX "StoreOrder_storeId_paymentStatus_idx" ON "StoreOrder"("storeId", "paymentStatus");

-- FKs. Pago → Orden: Restrict (una orden con pagos no se borra). Confirmante → User: SetNull (preserva el
-- historial de dinero si el empleado borra su cuenta).
ALTER TABLE "StorePayment" ADD CONSTRAINT "StorePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorePayment" ADD CONSTRAINT "StorePayment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
