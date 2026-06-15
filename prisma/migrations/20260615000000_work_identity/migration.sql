-- Fase 2 catálogo propio: identidad de obra (Work) + workId en PublisherEdition.
CREATE TABLE "Work" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "normTitle" TEXT NOT NULL,
    "coverImage" TEXT,
    "anilistId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Work_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Work_anilistId_key" ON "Work"("anilistId");
CREATE INDEX "Work_normTitle_idx" ON "Work"("normTitle");

ALTER TABLE "PublisherEdition" ADD COLUMN "workId" INTEGER;
CREATE INDEX "PublisherEdition_workId_idx" ON "PublisherEdition"("workId");

ALTER TABLE "PublisherEdition" ADD CONSTRAINT "PublisherEdition_workId_fkey"
    FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;
