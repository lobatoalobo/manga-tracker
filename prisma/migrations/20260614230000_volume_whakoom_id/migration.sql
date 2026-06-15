-- Identidad fuerte por id de Whakoom + tomos individuales (Fase 1 catálogo propio).
ALTER TABLE "PublisherEdition" ADD COLUMN "whakoomId" TEXT;
CREATE UNIQUE INDEX "PublisherEdition_whakoomId_key" ON "PublisherEdition"("whakoomId");

CREATE TABLE "Volume" (
    "id" SERIAL NOT NULL,
    "editionId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "whakoomComicId" TEXT,
    "isbn" TEXT,
    "coverImage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Volume_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Volume_editionId_number_key" ON "Volume"("editionId", "number");
CREATE INDEX "Volume_isbn_idx" ON "Volume"("isbn");

ALTER TABLE "Volume" ADD CONSTRAINT "Volume_editionId_fkey"
    FOREIGN KEY ("editionId") REFERENCES "PublisherEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
