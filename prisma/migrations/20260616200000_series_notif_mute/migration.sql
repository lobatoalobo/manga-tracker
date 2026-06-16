-- Silenciar notis de una serie puntual (override del toggle global).
CREATE TABLE "SeriesNotifMute" (
  "userId" TEXT NOT NULL,
  "anilistId" INTEGER NOT NULL,
  CONSTRAINT "SeriesNotifMute_pkey" PRIMARY KEY ("userId","anilistId")
);
CREATE INDEX "SeriesNotifMute_anilistId_idx" ON "SeriesNotifMute"("anilistId");
ALTER TABLE "SeriesNotifMute" ADD CONSTRAINT "SeriesNotifMute_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
