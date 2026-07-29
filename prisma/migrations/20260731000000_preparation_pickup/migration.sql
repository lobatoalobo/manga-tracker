-- Retail / Preventas — Slice 7: preparación y retiro (handoff outbound por línea).
-- NO APLICADA aún: la base es compartida/gated. Se aplica con `prisma migrate deploy` sobre el Postgres
-- EFÍMERO de tests / staging, nunca desde scripts locales ni a producción.
--
-- Aditivo: agrega a `StoreOrderLine` dos contadores del tramo outbound (preparado/retirado). Continúan el
-- ciclo físico de Slice 4 (arrived → prepared → picked_up). Defaults seguros: las líneas existentes quedan
-- en 0/0 (backfill implícito: nada preparado/retirado históricamente). Los eventos PREPARED/PICKED_UP usan
-- la columna TEXT existente `StoreOrderLineEvent.type` (sin CHECK) → sin cambio de tipo SQL. Sin índices ni
-- constraints nuevos. Los estados de handoff se derivan al leer y NO se persisten.

ALTER TABLE "StoreOrderLine"
  ADD COLUMN "preparedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pickedUpQuantity" INTEGER NOT NULL DEFAULT 0;
