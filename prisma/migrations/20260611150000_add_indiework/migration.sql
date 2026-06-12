-- CreateTable
CREATE TABLE "IndieWork" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "synopsis" TEXT,
    "coverUrl" TEXT,
    "buyUrl" TEXT,
    "social" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndieWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndieWork_status_idx" ON "IndieWork"("status");
