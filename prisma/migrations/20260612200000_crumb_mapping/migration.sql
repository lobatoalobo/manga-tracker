-- Override manual del término de búsqueda de Crumb por serie.
CREATE TABLE "CrumbMapping" (
    "anilistId" INTEGER NOT NULL,
    "query" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrumbMapping_pkey" PRIMARY KEY ("anilistId")
);
