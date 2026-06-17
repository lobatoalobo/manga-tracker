-- Snapshot de salidas anunciadas en ivrea.com.ar/proximas/ (lanzamiento, debut,
-- tomo único o reedición de tomo agotado). Reemplazo total por el cron mensual.
CREATE TABLE "IvreaRelease" (
  "id" SERIAL NOT NULL,
  "slug" TEXT,
  "title" TEXT NOT NULL,
  "volume" INTEGER,
  "kind" TEXT NOT NULL,
  "releaseDate" TIMESTAMP(3),
  "editionId" INTEGER,
  "anilistId" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IvreaRelease_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IvreaRelease_anilistId_idx" ON "IvreaRelease"("anilistId");
CREATE INDEX "IvreaRelease_editionId_idx" ON "IvreaRelease"("editionId");
CREATE INDEX "IvreaRelease_releaseDate_idx" ON "IvreaRelease"("releaseDate");
