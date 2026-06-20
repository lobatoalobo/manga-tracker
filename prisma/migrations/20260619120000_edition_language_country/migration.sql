-- Ediciones internacionales: idioma/país por edición (ver docs/plan-viz-en.md).
ALTER TABLE "PublisherEdition" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'es';
ALTER TABLE "PublisherEdition" ADD COLUMN IF NOT EXISTS "country" TEXT;

-- Backfill: las editoriales argentinas → country AR; las españolas → ES.
UPDATE "PublisherEdition" SET "country" = 'AR'
  WHERE "country" IS NULL AND "publisher" IN ('Ivrea Argentina', 'Panini Argentina', 'Ovni Press');
UPDATE "PublisherEdition" SET "country" = 'ES'
  WHERE "country" IS NULL AND "publisher" IN ('Kemuri Ediciones', 'Utopía Editorial', 'Larp Editores', 'Distrito Manga', 'Planeta Cómic');
