-- Slice "Asociar una referencia externa" — procedencia de la decisión de asociación.
-- NO APLICADA aún (base compartida/gated). No toca la slice Conferir: solo agrega columnas
-- NULLABLE a IdentityExternalReference. Las referencias semilla (Conferir) quedan con NULL.
-- El índice único sobre `decisionId` permite múltiples NULL (Postgres trata NULL como distinto),
-- así conviven las semillas (NULL) con las asociaciones (decisionId no nulo).

ALTER TABLE "IdentityExternalReference" ADD COLUMN "decisionId" TEXT;
ALTER TABLE "IdentityExternalReference" ADD COLUMN "decisionFingerprint" TEXT;

CREATE UNIQUE INDEX "IdentityExternalReference_decisionId_key" ON "IdentityExternalReference"("decisionId");
