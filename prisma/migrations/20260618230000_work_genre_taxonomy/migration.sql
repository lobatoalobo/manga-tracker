-- Géneros canónicos: backup de los crudos (MU/MD) + demografía como eje aparte.
-- Idempotente (IF NOT EXISTS) para poder aplicarla también desde el editor SQL.
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "rawGenres" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "demographic" TEXT;
