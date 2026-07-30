-- Retail / Slice "vínculo de catálogo opcional": la oferta pasa a ser auto-descriptiva y el Volume es una
-- identidad de catálogo OPCIONAL. Se ensancha (expand-only) `volumeId` de NOT NULL a NULLABLE en la oferta y
-- en la línea de pedido, para admitir ofertas manuales (lanzamientos aún no catalogados).
--
-- Seguro sobre tablas pobladas: solo AFLOJA la restricción (widening); las filas existentes conservan su valor.
-- Se conservan la FK (onDelete: Restrict, ahora sobre una relación opcional) y el UNIQUE(campaignId, volumeId)
-- de la oferta (en Postgres los NULL son distintos → no constriñe las manuales, sin colisiones falsas).
-- Sin backfill. `Acquisition`/`OwnershipPosition` NO se tocan (Collection sigue estrictamente volume-keyed).
--
-- Orden de despliegue (migrate-first): aplicar esta migración ANTES de desplegar el código; el flag
-- `retail-manual-offers` (write path) queda apagado hasta validar.
ALTER TABLE "PreorderOffer" ALTER COLUMN "volumeId" DROP NOT NULL;
ALTER TABLE "StoreOrderLine" ALTER COLUMN "volumeId" DROP NOT NULL;
