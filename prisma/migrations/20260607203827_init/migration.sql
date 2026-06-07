-- CreateTable
CREATE TABLE "Manga" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "totalVolumes" INTEGER NOT NULL,
    "ownedVolumes" TEXT NOT NULL
);
