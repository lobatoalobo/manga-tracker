-- Marca obras solo-nacionales (sin equivalente en AniList): anilistId null a
-- propósito, no son "sin mapear".
ALTER TABLE "PublisherEdition" ADD COLUMN "nationalOnly" BOOLEAN NOT NULL DEFAULT false;
