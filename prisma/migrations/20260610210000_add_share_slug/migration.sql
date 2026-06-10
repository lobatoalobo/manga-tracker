ALTER TABLE "User" ADD COLUMN "shareSlug" TEXT;
CREATE UNIQUE INDEX "User_shareSlug_key" ON "User"("shareSlug");
