-- Géneros editables + flag "Próximo a salir" (preventa AR) en Work.
ALTER TABLE "Work" ADD COLUMN "genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Work" ADD COLUMN "upcoming" BOOLEAN NOT NULL DEFAULT false;
