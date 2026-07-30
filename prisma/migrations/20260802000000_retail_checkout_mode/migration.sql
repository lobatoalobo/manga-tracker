-- Retail / Slice P0: experiencia de checkout conversacional (CheckoutMode).
-- NO APLICADA aún: la base es compartida/gated (ver memoria del proyecto). Se aplica con
-- `prisma migrate deploy` sobre staging/base desechable, y a PRODUCCIÓN **antes** de desplegar el código
-- que la lee (migrate-first, evita la clase de incidente "código adelantado al esquema" → P2022).
--
-- Aditivo/expand-only: agrega UNA columna con default a StoreCommerceProfile. Seguro sobre tabla poblada
-- (sin backfill; el default aplica). No toca ninguna otra tabla. En P0 el único valor es 'CONVERSATIONAL';
-- P1 sumará 'SELF_SERVICE' de forma aditiva.
ALTER TABLE "StoreCommerceProfile" ADD COLUMN "checkoutMode" TEXT NOT NULL DEFAULT 'CONVERSATIONAL';
