-- Conteo de tomos por el que ya se notificó "tomo nuevo". Se baseliza a los
-- valores actuales para no notificar el catálogo existente.
ALTER TABLE "PublisherEdition" ADD COLUMN "notifiedVolumes" INTEGER NOT NULL DEFAULT 0;
UPDATE "PublisherEdition" SET "notifiedVolumes" = "volumes";
