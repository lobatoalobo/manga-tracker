-- Enriquecimiento de Works desde MangaUpdates/MangaDex: título original (romaji)
-- como llave de match y marca de cuándo se enriqueció.
ALTER TABLE "Work" ADD COLUMN "originalTitle" TEXT;
ALTER TABLE "Work" ADD COLUMN "enrichedAt" TIMESTAMP(3);
