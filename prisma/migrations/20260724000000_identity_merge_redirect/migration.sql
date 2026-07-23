-- Slice "Fusionar identidades" (ADR-008 + ADR-009): redirección permanente + procedencia de la fusión.
-- NO APLICADA aún: la base es compartida/gated (ver memoria del proyecto). Se aplica con
-- `prisma migrate deploy` sobre staging/base desechable, nunca desde scripts locales.
--
-- Preserva identidades existentes: las columnas son NULLABLE (las filas actuales quedan ACTIVE, sin
-- redirección ni procedencia). No toca Conferir/Asociar (sus `create` no setean estas columnas) ni la
-- FK compuesta de referencias activas (ADR-009). Los CHECK y la self-FK son CRUDOS (Prisma no modela
-- CHECK → drift documentado, igual que el índice parcial de designación y la FK compuesta de ADR-009).

-- 1. Columnas: destino de redirección + procedencia de la Decisión Fusionar (en la fila ABSORBIDA).
ALTER TABLE "CatalogIdentity" ADD COLUMN "redirectsToId" INTEGER;
ALTER TABLE "CatalogIdentity" ADD COLUMN "mergeDecisionId" TEXT;
ALTER TABLE "CatalogIdentity" ADD COLUMN "mergeDecisionFingerprint" TEXT;

-- 2. Índice de apoyo: "redirecciones entrantes" (regla anti-cadena v1) y resolución de handles.
CREATE INDEX "CatalogIdentity_redirectsToId_idx" ON "CatalogIdentity"("redirectsToId");

-- 3. Idempotencia + procedencia: una Decisión Fusionar redirige a lo sumo una identidad (permite NULL múltiple).
CREATE UNIQUE INDEX "CatalogIdentity_mergeDecisionId_key" ON "CatalogIdentity"("mergeDecisionId");

-- 4. Existencia del destino de redirección (self-FK). Las identidades no se borran (perpetuidad) → RESTRICT.
ALTER TABLE "CatalogIdentity" ADD CONSTRAINT "CatalogIdentity_redirectsToId_fkey"
  FOREIGN KEY ("redirectsToId") REFERENCES "CatalogIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. No autorredirección: una identidad no puede redirigir a sí misma (evita el ciclo trivial de un salto).
ALTER TABLE "CatalogIdentity" ADD CONSTRAINT "CatalogIdentity_no_self_redirect_check"
  CHECK ("redirectsToId" IS NULL OR "redirectsToId" <> "id");

-- 6. Coherencia estado ⇔ redirección (v1: solo ACTIVE/REDIRECTED). REDIRECTED ⟺ redirectsToId no nulo;
--    cualquier otro estado (ACTIVE) ⟺ redirectsToId nulo. Impide "REDIRECTED sin destino" y "ACTIVE con destino".
ALTER TABLE "CatalogIdentity" ADD CONSTRAINT "CatalogIdentity_state_redirect_check"
  CHECK (
    ("state" = 'REDIRECTED' AND "redirectsToId" IS NOT NULL)
    OR ("state" <> 'REDIRECTED' AND "redirectsToId" IS NULL)
  );

-- 7. Pareo de procedencia: id y huella presentes JUNTOS, y SOLO en filas redirigidas (nunca en ACTIVE).
ALTER TABLE "CatalogIdentity" ADD CONSTRAINT "CatalogIdentity_merge_provenance_check"
  CHECK (
    ("mergeDecisionId" IS NULL AND "mergeDecisionFingerprint" IS NULL)
    OR ("mergeDecisionId" IS NOT NULL AND "mergeDecisionFingerprint" IS NOT NULL AND "redirectsToId" IS NOT NULL)
  );

-- NOTA (destino ACTIVE / anti-cadena): que el destino de una redirección sea ACTIVE y que la absorbida no
-- tenga redirecciones entrantes (v1 no encadena) se valida TRANSACCIONALMENTE bajo lock en Fusionar, no por
-- una FK compuesta. A diferencia de ADR-009 (Asociar NO lockea → hace falta la FK), el ÚNICO escritor de
-- redirecciones es Fusionar, que ya toma `FOR UPDATE` sobre ambas identidades; no hay escritor sin lock que
-- una FK compuesta deba atajar. Se evita así denormalizar `redirectsToState` (ver docs/identity-merge-slice.md).
