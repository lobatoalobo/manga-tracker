-- Notificaciones de Deseados: pref + flag idempotente "ya avisé que salió".
ALTER TABLE "NotificationPref" ADD COLUMN "wishlist" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WishlistItem" ADD COLUMN "notifiedAvailable" BOOLEAN NOT NULL DEFAULT false;
