-- Reestructura Purchase: pasa a ser un encabezado de transacción (fecha/tienda/
-- estado) y los tomos van a PurchaseItem (precio por tomo). Tabla vacía en prod,
-- así que se puede recrear sin migrar datos.

-- Purchase: saca columnas de ítem, agrega note, cambia default de status.
ALTER TABLE "Purchase" DROP COLUMN "title";
ALTER TABLE "Purchase" DROP COLUMN "anilistId";
ALTER TABLE "Purchase" DROP COLUMN "volume";
ALTER TABLE "Purchase" DROP COLUMN "edition";
ALTER TABLE "Purchase" DROP COLUMN "price";
ALTER TABLE "Purchase" ADD COLUMN "note" TEXT;
ALTER TABLE "Purchase" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "anilistId" INTEGER,
    "coverImage" TEXT,
    "volume" INTEGER,
    "edition" TEXT,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
