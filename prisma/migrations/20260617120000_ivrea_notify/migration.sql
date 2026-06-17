-- Pref de reedición + dedup de notis disparadas desde IvreaRelease.
ALTER TABLE "NotificationPref" ADD COLUMN "reissue" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "IvreaReleaseNotified" (
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IvreaReleaseNotified_pkey" PRIMARY KEY ("key")
);
