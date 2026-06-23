-- Fase 1 del rediseño de datos (ver docs/analisis-sistema-datos.md).
-- Additivo: nombres multi-idioma + identidad externa estable + sinopsis por edición.
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "titleNative" TEXT;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "assistants" TEXT;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "muId" INTEGER;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "mdId" TEXT;

ALTER TABLE "PublisherEdition" ADD COLUMN IF NOT EXISTS "synopsis" TEXT;

-- Únicos en la identidad externa (NULLs permitidos / no colisionan en Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS "Work_muId_key" ON "Work"("muId");
CREATE UNIQUE INDEX IF NOT EXISTS "Work_mdId_key" ON "Work"("mdId");
