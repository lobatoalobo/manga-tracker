-- Tipo de contenido del Work (manga vs cómic vs novela, etc). Default MANGA.
ALTER TABLE "Work" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'MANGA';
