-- ADR-009: garantía DECLARATIVA "una IdentityExternalReference solo apunta a una CatalogIdentity
-- ACTIVE", vía FK COMPUESTA. NO APLICADA aún (base compartida/gated); aplicar/probar en el efímero.
-- La FK compuesta + CHECK + UNIQUE(id,state) son constraints CRUDOS (Prisma no los modela → drift
-- documentado, igual que el índice parcial de designación). La columna `identityState` SÍ está en el
-- schema Prisma. La FK simple `identityId → CatalogIdentity(id)` (migración 20260722000000) se
-- PRESERVA (redundante pero coherente); la compuesta es la guardia vinculante.

-- 1. UNIQUE (id, state): destino requerido por la FK compuesta. Se usa CONSTRAINT (no solo índice)
--    porque Postgres exige una unique/pk constraint para referenciarla por FK.
ALTER TABLE "CatalogIdentity" ADD CONSTRAINT "CatalogIdentity_id_state_key" UNIQUE ("id", "state");

-- 2-4. Columna denormalizada. DEFAULT 'ACTIVE' backfillea las filas existentes; NOT NULL en el mismo paso.
ALTER TABLE "IdentityExternalReference" ADD COLUMN "identityState" TEXT NOT NULL DEFAULT 'ACTIVE';

-- 5. CHECK: ningún valor distinto de 'ACTIVE' puede persistirse.
ALTER TABLE "IdentityExternalReference"
  ADD CONSTRAINT "IdentityExternalReference_identityState_active_check" CHECK ("identityState" = 'ACTIVE');

-- 6. FK COMPUESTA. ON UPDATE RESTRICT: cambiar el estado de una Identity con referencias apuntándola
--    falla → obliga a mover las referencias antes de redirigir. ON DELETE CASCADE: coherente con la
--    FK simple (las identidades no se borran; perpetuidad).
ALTER TABLE "IdentityExternalReference"
  ADD CONSTRAINT "IdentityExternalReference_identity_active_fkey"
  FOREIGN KEY ("identityId", "identityState") REFERENCES "CatalogIdentity"("id", "state")
  ON UPDATE RESTRICT ON DELETE CASCADE;

-- 7. `@@unique([provider, externalId])` se preserva (no se toca).
-- 8. Datos y relaciones actuales preservados (backfill 'ACTIVE'; la FK valida contra identidades ACTIVE).
