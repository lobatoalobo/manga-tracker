-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Manga" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "romajiTitle" TEXT NOT NULL,
    "englishTitle" TEXT,
    "nativeTitle" TEXT,
    "coverImage" TEXT NOT NULL,
    "apiTotalVolumes" INTEGER,
    "muVolumes" INTEGER,
    "customTotalVolumes" INTEGER,
    "publisher" TEXT,
    "editionSlug" TEXT,
    "argentinaStatus" TEXT,
    "argentinaVolumes" INTEGER,
    "japanStatus" TEXT,
    "japanVolumes" INTEGER,
    "nextVolume" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "readingStatus" TEXT NOT NULL DEFAULT 'UNREAD',
    "readingVolume" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Manga" ("apiTotalVolumes", "argentinaStatus", "argentinaVolumes", "coverImage", "createdAt", "customTotalVolumes", "editionSlug", "englishTitle", "id", "japanStatus", "japanVolumes", "muVolumes", "nativeTitle", "nextVolume", "publisher", "romajiTitle", "status") SELECT "apiTotalVolumes", "argentinaStatus", "argentinaVolumes", "coverImage", "createdAt", "customTotalVolumes", "editionSlug", "englishTitle", "id", "japanStatus", "japanVolumes", "muVolumes", "nativeTitle", "nextVolume", "publisher", "romajiTitle", "status" FROM "Manga";
DROP TABLE "Manga";
ALTER TABLE "new_Manga" RENAME TO "Manga";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
