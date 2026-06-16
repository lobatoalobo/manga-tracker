-- Fecha de salida borrosa: "2026" o "2026-07" (reemplaza releaseDate DateTime).
ALTER TABLE "Work" DROP COLUMN IF EXISTS "releaseDate";
ALTER TABLE "Work" ADD COLUMN "releaseLabel" TEXT;
