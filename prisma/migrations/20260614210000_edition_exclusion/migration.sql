-- "Esta editorial NO va en esta serie" (desvincular ediciones mal enganchadas).
CREATE TABLE "EditionExclusion" (
    "anilistId" INTEGER NOT NULL,
    "publisher" TEXT NOT NULL,

    CONSTRAINT "EditionExclusion_pkey" PRIMARY KEY ("anilistId", "publisher")
);
