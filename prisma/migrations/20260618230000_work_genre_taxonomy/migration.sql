-- Géneros canónicos: backup de los crudos (MU/MD) + demografía como eje aparte.
ALTER TABLE "Work" ADD COLUMN "rawGenres" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Work" ADD COLUMN "demographic" TEXT;
