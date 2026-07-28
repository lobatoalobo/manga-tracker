-- Retail / Preventas — Slice 3: reservas (StoreOrder + StoreOrderLine).
-- NO APLICADA aún: la base es compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres
-- EFÍMERO de tests / staging, nunca desde scripts locales ni a producción.
--
-- Aditivo: crea DOS tablas. Actividad histórica cuelga de `Store` (Restrict), nunca del perfil comercial.
-- `status` es TEXT (convención del repo: enum-like como String). Todas las FKs están modeladas en Prisma
-- (esta migración produce exactamente lo que declara el schema: mismos nombres de constraint, onDelete e
-- índices), así que NO hay drift entre schema y base. Las back-relations en Volume/User/Store/Campaign son
-- solo metadata de persistencia del ORM; el catálogo no depende de Retail.

CREATE TABLE "StoreOrder" (
    "id"                    SERIAL NOT NULL,
    "publicCode"            TEXT NOT NULL,
    "storeId"               INTEGER NOT NULL,
    "campaignId"            INTEGER NOT NULL,
    "userId"                TEXT,
    "status"                TEXT NOT NULL DEFAULT 'RESERVED',
    "customerNameSnapshot"  TEXT,
    "customerEmailSnapshot" TEXT,
    "totalCents"            INTEGER NOT NULL DEFAULT 0,
    "cancelledAt"           TIMESTAMP(3),
    "cancelledByUserId"     TEXT,
    "cancellationReason"    TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreOrderLine" (
    "id"                     SERIAL NOT NULL,
    "orderId"                INTEGER NOT NULL,
    "offerId"                INTEGER NOT NULL,
    "volumeId"               INTEGER NOT NULL,
    "quantity"               INTEGER NOT NULL,
    "unitListPriceCents"     INTEGER NOT NULL,
    "unitPreorderPriceCents" INTEGER NOT NULL,
    "lineTotalCents"         INTEGER NOT NULL,
    "titleSnapshot"          TEXT NOT NULL,
    "volumeNumberSnapshot"   INTEGER,
    "publisherSnapshot"      TEXT,
    "isbnSnapshot"           TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOrderLine_pkey" PRIMARY KEY ("id")
);

-- publicCode único; una orden por (campaign, user); índices de listado (usuario/tienda/campaña/estado/fecha).
CREATE UNIQUE INDEX "StoreOrder_publicCode_key" ON "StoreOrder"("publicCode");
CREATE UNIQUE INDEX "StoreOrder_campaignId_userId_key" ON "StoreOrder"("campaignId", "userId");
CREATE INDEX "StoreOrder_userId_idx" ON "StoreOrder"("userId");
CREATE INDEX "StoreOrder_storeId_idx" ON "StoreOrder"("storeId");
CREATE INDEX "StoreOrder_campaignId_idx" ON "StoreOrder"("campaignId");
CREATE INDEX "StoreOrder_status_idx" ON "StoreOrder"("status");
CREATE INDEX "StoreOrder_createdAt_idx" ON "StoreOrder"("createdAt");
CREATE INDEX "StoreOrder_storeId_status_idx" ON "StoreOrder"("storeId", "status");

-- Una línea por oferta dentro de la orden (las repetidas se consolidan antes de persistir).
CREATE UNIQUE INDEX "StoreOrderLine_orderId_offerId_key" ON "StoreOrderLine"("orderId", "offerId");
CREATE INDEX "StoreOrderLine_orderId_idx" ON "StoreOrderLine"("orderId");
CREATE INDEX "StoreOrderLine_offerId_idx" ON "StoreOrderLine"("offerId");
CREATE INDEX "StoreOrderLine_volumeId_idx" ON "StoreOrderLine"("volumeId");

-- FKs de la orden. Store/Campaign: Restrict (no se borran con órdenes). User/creador-cancelador: SetNull
-- (preservar historial si borra la cuenta; por eso userId es nullable). Con userId NULL, Postgres trata los
-- NULL como distintos en el índice único (campaignId, userId): no colisionan órdenes de cuentas borradas.
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PreorderCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FKs de la línea. Orden: Cascade (borrar una orden borra sus líneas; el dominio no hard-deletea órdenes
-- confirmadas). Oferta y Volume: Restrict (preservan el historial; no se borra lo referenciado por una línea).
ALTER TABLE "StoreOrderLine" ADD CONSTRAINT "StoreOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrderLine" ADD CONSTRAINT "StoreOrderLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PreorderOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreOrderLine" ADD CONSTRAINT "StoreOrderLine_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
