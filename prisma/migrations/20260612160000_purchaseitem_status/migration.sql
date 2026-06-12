-- Estado por tomo (antes era a nivel compra). Agrega la columna y copia el
-- estado de la compra a cada uno de sus tomos para no perder lo cargado.
ALTER TABLE "PurchaseItem" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'RECEIVED';

UPDATE "PurchaseItem" AS i
SET "status" = p."status"
FROM "Purchase" AS p
WHERE i."purchaseId" = p."id";
