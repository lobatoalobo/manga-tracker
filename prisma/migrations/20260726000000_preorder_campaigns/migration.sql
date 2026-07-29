-- Retail / Preventas — Slice 2: campañas de preventa + ofertas (manual).
-- NO APLICADA aún: la base es compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres
-- EFÍMERO de tests / staging, nunca desde scripts locales ni a producción.
--
-- Aditivo: crea DOS tablas. Actividad histórica cuelga de `Store` (Restrict). `status` es TEXT (convención
-- del repo: enum-like como String, sin enums de Postgres). La FK `PreorderOffer.volumeId → Volume` está
-- MODELADA en Prisma (relación `PreorderOffer.volume` + back-relation `Volume.preorderOffers`): esta
-- migración produce exactamente lo que el schema declara (mismo nombre de constraint, RESTRICT, índice), así
-- que NO hay drift entre schema y base. La back-relation es solo metadata de persistencia del ORM; el
-- catálogo no depende de Retail.

CREATE TABLE "PreorderCampaign" (
    "id"              SERIAL NOT NULL,
    "storeId"         INTEGER NOT NULL,
    "title"           TEXT NOT NULL,
    "description"     TEXT,
    "weekLabel"       TEXT,
    "status"          TEXT NOT NULL DEFAULT 'DRAFT',
    "opensAt"         TIMESTAMP(3),
    "closesAt"        TIMESTAMP(3),
    "publishedAt"     TIMESTAMP(3),
    "closedAt"        TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreorderOffer" (
    "id"                   SERIAL NOT NULL,
    "campaignId"           INTEGER NOT NULL,
    "volumeId"             INTEGER NOT NULL,
    "titleSnapshot"        TEXT NOT NULL,
    "volumeNumberSnapshot" INTEGER,
    "publisherSnapshot"    TEXT,
    "isbnSnapshot"         TEXT,
    "listPriceCents"       INTEGER NOT NULL,
    "preorderPriceCents"   INTEGER NOT NULL,
    "status"               TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder"            INTEGER NOT NULL DEFAULT 0,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderOffer_pkey" PRIMARY KEY ("id")
);

-- Índices de campaña: por tienda, por estado, combinado, y por fechas (disponibilidad/publicación).
CREATE INDEX "PreorderCampaign_storeId_idx" ON "PreorderCampaign"("storeId");
CREATE INDEX "PreorderCampaign_status_idx" ON "PreorderCampaign"("status");
CREATE INDEX "PreorderCampaign_storeId_status_idx" ON "PreorderCampaign"("storeId", "status");
CREATE INDEX "PreorderCampaign_publishedAt_idx" ON "PreorderCampaign"("publishedAt");
CREATE INDEX "PreorderCampaign_opensAt_idx" ON "PreorderCampaign"("opensAt");
CREATE INDEX "PreorderCampaign_closesAt_idx" ON "PreorderCampaign"("closesAt");

-- Un Volume aparece a lo sumo UNA vez por campaña.
CREATE UNIQUE INDEX "PreorderOffer_campaignId_volumeId_key" ON "PreorderOffer"("campaignId", "volumeId");
CREATE INDEX "PreorderOffer_campaignId_idx" ON "PreorderOffer"("campaignId");
CREATE INDEX "PreorderOffer_volumeId_idx" ON "PreorderOffer"("volumeId");

-- FKs. Store: Restrict (una tienda con campañas no se borra). Creador: SetNull (durabilidad si borra cuenta).
ALTER TABLE "PreorderCampaign" ADD CONSTRAINT "PreorderCampaign_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PreorderCampaign" ADD CONSTRAINT "PreorderCampaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Oferta → Campaña: Cascade (borrar un DRAFT borra sus ofertas; el dominio solo borra DRAFT).
ALTER TABLE "PreorderOffer" ADD CONSTRAINT "PreorderOffer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PreorderCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Oferta → Volume: modelada en Prisma (relación `PreorderOffer.volume`). RESTRICT: no se borra un Volume
-- referenciado por una oferta histórica. Sobrevive a Merge (absorbWorkInto re-parenta PublisherEdition.workId;
-- Volume.id y Volume.editionId no cambian). Ver docs/retail-slice-2-preorder-campaigns.md.
ALTER TABLE "PreorderOffer" ADD CONSTRAINT "PreorderOffer_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
