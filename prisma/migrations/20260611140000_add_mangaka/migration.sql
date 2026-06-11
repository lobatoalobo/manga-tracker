-- CreateTable
CREATE TABLE "Mangaka" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mangaka_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mangaka_normName_idx" ON "Mangaka"("normName");

-- CreateTable
CREATE TABLE "AppState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("key")
);
