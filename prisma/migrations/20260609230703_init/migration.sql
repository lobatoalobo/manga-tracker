-- CreateTable
CREATE TABLE "Manga" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "romajiTitle" TEXT NOT NULL,
    "englishTitle" TEXT,
    "nativeTitle" TEXT,
    "coverImage" TEXT NOT NULL,
    "apiTotalVolumes" INTEGER,
    "customTotalVolumes" INTEGER,
    "publisher" TEXT,
    "editionSlug" TEXT,
    "argentinaStatus" TEXT,
    "argentinaVolumes" INTEGER,
    "japanStatus" TEXT,
    "japanVolumes" INTEGER,
    "nextVolume" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OwnedVolume" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mangaId" INTEGER NOT NULL,
    "volume" INTEGER NOT NULL,
    CONSTRAINT "OwnedVolume_mangaId_fkey" FOREIGN KEY ("mangaId") REFERENCES "Manga" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnedVolume_mangaId_volume_key" ON "OwnedVolume"("mangaId", "volume");
