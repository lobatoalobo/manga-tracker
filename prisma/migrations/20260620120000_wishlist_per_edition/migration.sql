-- Deseados por edición (no por obra): editionKey + publisher/region.
ALTER TABLE "WishlistItem" ADD COLUMN IF NOT EXISTS "editionKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WishlistItem" ADD COLUMN IF NOT EXISTS "publisher" TEXT;
ALTER TABLE "WishlistItem" ADD COLUMN IF NOT EXISTS "region" TEXT;

-- Backfill: los deseados legacy de obras locales con edición Ivrea → key "ivrea"
-- (la mayoría era de la época Ivrea-only). El resto queda "" (cualquiera).
UPDATE "WishlistItem" w
   SET "editionKey" = 'ivrea', "publisher" = 'Ivrea Argentina', "region" = 'AR'
 WHERE w."editionKey" = ''
   AND w."anilistId" < 0
   AND EXISTS (
     SELECT 1 FROM "PublisherEdition" e
      WHERE e."workId" = -w."anilistId" AND e."publisher" = 'Ivrea Argentina'
   );

-- Reemplazar el unique (userId, anilistId) por (userId, anilistId, editionKey).
ALTER TABLE "WishlistItem" DROP CONSTRAINT IF EXISTS "WishlistItem_userId_anilistId_key";
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'WishlistItem_userId_anilistId_editionKey_key'
  ) THEN
    ALTER TABLE "WishlistItem"
      ADD CONSTRAINT "WishlistItem_userId_anilistId_editionKey_key"
      UNIQUE ("userId", "anilistId", "editionKey");
  END IF;
END $$;
