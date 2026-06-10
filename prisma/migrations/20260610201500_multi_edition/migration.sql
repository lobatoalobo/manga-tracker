-- Nueva tabla TrackedEdition
CREATE TABLE "TrackedEdition" (
    "id" SERIAL NOT NULL,
    "mangaId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "publisher" TEXT,
    "slug" TEXT,
    "region" TEXT NOT NULL DEFAULT 'AR',
    "totalVolumes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "readingStatus" TEXT NOT NULL DEFAULT 'UNREAD',
    "readingVolume" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedEdition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrackedEdition_mangaId_key_key" ON "TrackedEdition"("mangaId", "key");
ALTER TABLE "TrackedEdition" ADD CONSTRAINT "TrackedEdition_mangaId_fkey"
    FOREIGN KEY ("mangaId") REFERENCES "Manga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: una edición trackeada por cada serie existente
INSERT INTO "TrackedEdition" ("mangaId","key","label","publisher","slug","region","totalVolumes","status","readingStatus","readingVolume","createdAt")
SELECT
    "id",
    CASE "publisher"
        WHEN 'Ivrea Argentina' THEN 'ivrea'
        WHEN 'Panini Argentina' THEN 'panini'
        WHEN 'Ovni Press' THEN 'ovni'
        ELSE 'edicion'
    END,
    COALESCE("publisher", 'Edición'),
    "publisher",
    "editionSlug",
    'AR',
    COALESCE("customTotalVolumes", "muVolumes", "apiTotalVolumes", 0),
    "status",
    "readingStatus",
    "readingVolume",
    CURRENT_TIMESTAMP
FROM "Manga";

-- OwnedVolume: pasar de mangaId a editionId
ALTER TABLE "OwnedVolume" ADD COLUMN "editionId" INTEGER;
UPDATE "OwnedVolume" ov SET "editionId" = te."id"
    FROM "TrackedEdition" te WHERE te."mangaId" = ov."mangaId";
DELETE FROM "OwnedVolume" WHERE "editionId" IS NULL;
ALTER TABLE "OwnedVolume" ALTER COLUMN "editionId" SET NOT NULL;
ALTER TABLE "OwnedVolume" DROP CONSTRAINT IF EXISTS "OwnedVolume_mangaId_fkey";
DROP INDEX IF EXISTS "OwnedVolume_mangaId_volume_key";
ALTER TABLE "OwnedVolume" DROP COLUMN "mangaId";
CREATE UNIQUE INDEX "OwnedVolume_editionId_volume_key" ON "OwnedVolume"("editionId", "volume");
ALTER TABLE "OwnedVolume" ADD CONSTRAINT "OwnedVolume_editionId_fkey"
    FOREIGN KEY ("editionId") REFERENCES "TrackedEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manga: quitar columnas de edición (ahora viven en TrackedEdition)
ALTER TABLE "Manga"
    DROP COLUMN "customTotalVolumes",
    DROP COLUMN "publisher",
    DROP COLUMN "editionSlug",
    DROP COLUMN "argentinaStatus",
    DROP COLUMN "argentinaVolumes",
    DROP COLUMN "japanStatus",
    DROP COLUMN "japanVolumes",
    DROP COLUMN "nextVolume",
    DROP COLUMN "status",
    DROP COLUMN "readingStatus",
    DROP COLUMN "readingVolume";
