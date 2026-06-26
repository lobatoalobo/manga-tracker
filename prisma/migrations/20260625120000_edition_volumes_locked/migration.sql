-- Conteo de tomos editado a mano (no lo pisa el crawl) cuando está en true.
ALTER TABLE "PublisherEdition" ADD COLUMN "volumesLocked" BOOLEAN NOT NULL DEFAULT false;
