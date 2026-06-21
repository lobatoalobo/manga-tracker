-- El @@unique([userId, anilistId]) viejo de Prisma es un UNIQUE INDEX, no un
-- table CONSTRAINT. La migración anterior hizo DROP CONSTRAINT IF EXISTS (no-op
-- sobre un index), así que el unique viejo quedó vivo y bloqueaba desear una 2ª
-- edición de la misma obra. Lo borramos como index (y como constraint por las
-- dudas, segun como lo haya creado Prisma).
DROP INDEX IF EXISTS "WishlistItem_userId_anilistId_key";
ALTER TABLE "WishlistItem" DROP CONSTRAINT IF EXISTS "WishlistItem_userId_anilistId_key";
