-- Los series id NUEVOS de MangaUpdates exceden INT4 (ej. 51239621230). muId pasa
-- a TEXT (es un identificador, no un número). El índice único se reconstruye solo.
ALTER TABLE "Work" ALTER COLUMN "muId" TYPE TEXT USING "muId"::text;
