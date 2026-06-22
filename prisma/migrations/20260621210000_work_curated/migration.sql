-- Campos editados a mano por el admin que ningún job debe pisar (ni --force).
ALTER TABLE "Work" ADD COLUMN IF NOT EXISTS "curated" TEXT[] NOT NULL DEFAULT '{}';
