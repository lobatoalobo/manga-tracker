-- ADR-008 (dependencia de Catálogo para Fusionar): "absorber un Work dentro de otro".
-- NO APLICADA aún (base compartida/gated); aplicar/probar en el efímero.
-- `absorbedIntoId != null` = estado normativo "absorbido" (sin columna duplicada). Sin borrado
-- físico: perpetuidad del contenido. El CHECK de no-autoabsorción es crudo (Prisma no modela CHECK
-- → drift documentado, igual que otros constraints de identidad).

-- Columna + self-FK (Prisma-managed vía la relación "WorkAbsorption") + índice.
ALTER TABLE "Work" ADD COLUMN "absorbedIntoId" INTEGER;

CREATE INDEX "Work_absorbedIntoId_idx" ON "Work"("absorbedIntoId");

ALTER TABLE "Work" ADD CONSTRAINT "Work_absorbedIntoId_fkey"
  FOREIGN KEY ("absorbedIntoId") REFERENCES "Work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No-autoabsorción (constraint local, expresable en Postgres): un Work no puede absorberse a sí mismo.
ALTER TABLE "Work" ADD CONSTRAINT "Work_no_self_absorption_check"
  CHECK ("absorbedIntoId" IS NULL OR "absorbedIntoId" <> "id");
