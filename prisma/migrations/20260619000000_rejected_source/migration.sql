-- Fuentes descartadas (Whakoom/Ivrea) que el crawl/import no debe re-importar.
CREATE TABLE IF NOT EXISTS "RejectedSource" (
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedSource_pkey" PRIMARY KEY ("source", "sourceId")
);
