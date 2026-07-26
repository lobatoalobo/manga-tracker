-- Retail / Preventas — Slice 5: avisos de llegada al cliente (StoreOrderNotification + …Item).
-- NO APLICADA aún: la base es compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres
-- EFÍMERO de tests / staging, nunca desde scripts locales ni a producción.
--
-- Aditivo: crea DOS tablas. El aviso cuelga de `StoreOrder` (Restrict). `status`/`type`/`channel` son TEXT
-- (convención del repo). Todas las FKs están modeladas en Prisma (sin drift). No toca tablas previas ni el
-- catálogo. Los avisos NO modifican contadores de fulfillment; "informado" se deriva de los ítems SENT.

CREATE TABLE "StoreOrderNotification" (
    "id"                SERIAL NOT NULL,
    "orderId"           INTEGER NOT NULL,
    "type"              TEXT NOT NULL DEFAULT 'ARRIVAL',
    "status"            TEXT NOT NULL DEFAULT 'DRAFT',
    "channel"           TEXT NOT NULL DEFAULT 'MANUAL',
    "recipientSnapshot" TEXT,
    "messageSnapshot"   TEXT NOT NULL,
    "createdByUserId"   TEXT,
    "sentByUserId"      TEXT,
    "sendOperationKey"  TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"            TIMESTAMP(3),
    "cancelledAt"       TIMESTAMP(3),
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrderNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreOrderNotificationItem" (
    "id"             SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "orderLineId"    INTEGER NOT NULL,
    "quantity"       INTEGER NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOrderNotificationItem_pkey" PRIMARY KEY ("id")
);

-- `updatedAt` lo gestiona Prisma (@updatedAt, sin default en el schema); tabla nueva/vacía, sin backfill.
CREATE UNIQUE INDEX "StoreOrderNotification_sendOperationKey_key" ON "StoreOrderNotification"("sendOperationKey");
CREATE INDEX "StoreOrderNotification_orderId_idx" ON "StoreOrderNotification"("orderId");
CREATE INDEX "StoreOrderNotification_status_idx" ON "StoreOrderNotification"("status");
CREATE INDEX "StoreOrderNotification_type_idx" ON "StoreOrderNotification"("type");
CREATE INDEX "StoreOrderNotification_createdAt_idx" ON "StoreOrderNotification"("createdAt");
CREATE INDEX "StoreOrderNotification_sentAt_idx" ON "StoreOrderNotification"("sentAt");

CREATE UNIQUE INDEX "StoreOrderNotificationItem_notificationId_orderLineId_key" ON "StoreOrderNotificationItem"("notificationId", "orderLineId");
CREATE INDEX "StoreOrderNotificationItem_orderLineId_idx" ON "StoreOrderNotificationItem"("orderLineId");
CREATE INDEX "StoreOrderNotificationItem_notificationId_idx" ON "StoreOrderNotificationItem"("notificationId");

-- FKs. Notificación → Orden: Restrict (una orden con avisos no se borra). Creador/emisor → User: SetNull.
ALTER TABLE "StoreOrderNotification" ADD CONSTRAINT "StoreOrderNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreOrderNotification" ADD CONSTRAINT "StoreOrderNotification_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreOrderNotification" ADD CONSTRAINT "StoreOrderNotification_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ítem → Notificación: Cascade (vive con su aviso). Ítem → Línea: Restrict (preserva el historial informado).
ALTER TABLE "StoreOrderNotificationItem" ADD CONSTRAINT "StoreOrderNotificationItem_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "StoreOrderNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrderNotificationItem" ADD CONSTRAINT "StoreOrderNotificationItem_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "StoreOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
