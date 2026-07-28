/**
 * Composition root de lectura del read-side unificado (ADR-011, Slice 9 / Checkpoint 7). SOLO cableado de
 * dependencias: enchufa los adapters concretos (Collection de Slice 8 + legado `OwnedVolume`) al reader puro
 * (`createOwnershipReader`). NO contiene lógica de dominio, NO reconstruye claves, NO mapea DTOs, NO mantiene
 * estado global mutable: cada llamada arma el reader con las fuentes sobre el client recibido. Reutiliza el
 * Prisma global de la app (convención existente); `buildOwnershipReader` toma el client explícito para permitir
 * tests sobre una base desechable y un sink capturador inyectado.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { collectionOwnershipSource } from "@/lib/collection-read/adapters/collection";
import { legacyOwnershipSource } from "@/lib/collection-read/adapters/legacy";
import { createOwnershipReader } from "@/lib/collection-read/facade";
import type { ReconciliationSink } from "@/lib/collection-read/reconciliation";
import type { LegacyObservation } from "@/lib/collection-read/ports";

/** Cablea el reader real sobre un `client` dado. Wiring puro: dos adapters + reader, sin transformar nada. */
export function buildOwnershipReader(
  client: PrismaClient,
  reconciliationSink?: ReconciliationSink<LegacyObservation>,
) {
  return createOwnershipReader({
    collection: collectionOwnershipSource(client),
    legacy: legacyOwnershipSource(client),
    reconciliationSink,
  });
}

/** Reader por defecto sobre el Prisma global de la app (sin observabilidad conectada todavía en F1). */
export function ownershipReader(reconciliationSink?: ReconciliationSink<LegacyObservation>) {
  return buildOwnershipReader(prisma, reconciliationSink);
}
