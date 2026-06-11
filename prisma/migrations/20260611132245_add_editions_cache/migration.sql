-- CreateTable
CREATE TABLE "EditionsCache" (
    "anilistId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditionsCache_pkey" PRIMARY KEY ("anilistId")
);
