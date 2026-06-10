-- CreateTable
CREATE TABLE "PublisherEdition" (
    "id" SERIAL NOT NULL,
    "publisher" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normTitle" TEXT NOT NULL,
    "volumes" INTEGER NOT NULL,
    "status" TEXT,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublisherEdition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublisherEdition_normTitle_idx" ON "PublisherEdition"("normTitle");

-- CreateIndex
CREATE UNIQUE INDEX "PublisherEdition_publisher_slug_key" ON "PublisherEdition"("publisher", "slug");
