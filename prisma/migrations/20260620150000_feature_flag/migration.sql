-- Feature flags (estado on/off por flag, editable desde admin).
CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  "key"       TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);
