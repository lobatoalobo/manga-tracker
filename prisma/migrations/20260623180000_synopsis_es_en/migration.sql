-- Sinopsis por idioma (tabs ES/EN). Additivo; `synopsis` queda de transición.
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "synopsisEs" TEXT;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "synopsisEn" TEXT;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "synopsisEsAuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "synopsisEnAuto" BOOLEAN NOT NULL DEFAULT false;
