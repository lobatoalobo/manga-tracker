-- Preferencias de notificación por usuario (un toggle por categoría).
-- Sin fila = todo activado (defaults true).
CREATE TABLE "NotificationPref" (
    "userId" TEXT NOT NULL,
    "newVolume" BOOLEAN NOT NULL DEFAULT true,
    "social" BOOLEAN NOT NULL DEFAULT true,
    "friends" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
