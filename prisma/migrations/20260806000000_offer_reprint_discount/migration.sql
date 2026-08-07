-- Retail / Estudio SaaS: la oferta gana dos campos ADITIVOS y no comerciales que alimentan la vista previa del
-- mensaje al cliente:
--   * isReprint            → la oferta es una reimpresión (se agrupa aparte en "REIMPRESIONES:").
--   * publisherDiscountPct → descuento snapshot de la editorial en esta preventa (0..100), o NULL.
--
-- Seguro sobre tablas pobladas: solo AGREGA columnas. `isReprint` con DEFAULT false llena las filas existentes;
-- `publisherDiscountPct` es NULLABLE (sin backfill). No tocan precios, cumplimiento ni órdenes.
--
-- Orden de despliegue (migrate-first): aplicar esta migración ANTES de desplegar el código.
ALTER TABLE "PreorderOffer" ADD COLUMN "isReprint" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PreorderOffer" ADD COLUMN "publisherDiscountPct" INTEGER;
