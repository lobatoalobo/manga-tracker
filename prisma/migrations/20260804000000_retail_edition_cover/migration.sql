-- Retail / P-03 · Estudio (ADR-013) — modelo de PORTADA de la edición (X-4). ADITIVA y segura sobre tablas
-- pobladas: solo AGREGA columnas nullable/con default y un FK opcional; no transforma ni reescribe filas.
--
-- Tres conceptos, explícitos y separados:
--   * `PreorderOffer.onCover`            → la oferta está en portada (graduado). default false.
--   * `PreorderCampaign.principalOfferId`→ la oferta PRINCIPAL de la portada (una por campaña). nullable.
--   * el ORDEN reusa `PreorderOffer.sortOrder` existente (sin cambio de schema).
--
-- Compatibilidad con filas existentes (SIN backfill): toda oferta queda `onCover = false` y toda campaña
-- con `principalOfferId = NULL` ⇒ portada vacía, que es un estado VÁLIDO (D-006). Nada productivo lee estas
-- columnas hasta el commit de UI del Estudio.
--
-- FK `principalOfferId → PreorderOffer(id)` con ON DELETE SET NULL: borrar/desvincular la oferta principal
-- deja la campaña sin principal (no se auto-elige otra, D-008). Invariante "principal ⇒ onCover ∧ ACTIVE"
-- se mantiene en el dominio/servicios dentro de la misma transacción, no en la DB.
--
-- Orden de despliegue (migrate-first): aplicar ANTES de desplegar el código del Estudio.

-- AlterTable
ALTER TABLE "PreorderOffer" ADD COLUMN "onCover" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PreorderCampaign" ADD COLUMN "principalOfferId" INTEGER;

-- CreateIndex
CREATE INDEX "PreorderOffer_campaignId_onCover_idx" ON "PreorderOffer"("campaignId", "onCover");

-- CreateIndex
CREATE INDEX "PreorderCampaign_principalOfferId_idx" ON "PreorderCampaign"("principalOfferId");

-- AddForeignKey
ALTER TABLE "PreorderCampaign" ADD CONSTRAINT "PreorderCampaign_principalOfferId_fkey" FOREIGN KEY ("principalOfferId") REFERENCES "PreorderOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
