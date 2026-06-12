-- Descuento (%) a nivel compra, sobre el subtotal (ej. promos de Crumb).
ALTER TABLE "Purchase" ADD COLUMN "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;
