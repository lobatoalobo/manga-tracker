/**
 * F2.2 — Unit puro (sin DB): builder determinístico del `AcquisitionFact` de backfill y clasificación EXPLÍCITA de
 * resultados/errores de `establishLegacyPresence`. La clasificación se ejerce inyectando un `$transaction` que
 * rechaza con errores fabricados (no toca Postgres).
 */
import { describe, expect, it } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CollectionError, COLLECTION_ERROR } from "@/lib/domain/collection/errors";
import { ACQUISITION_CHANNEL } from "@/lib/domain/collection/acquisition";
import {
  BACKFILL_RESULT,
  BackfillInconsistencyError,
  buildLegacyBackfillFact,
  establishLegacyPresence,
  legacyBackfillAcquisitionKey,
  LEGACY_BACKFILL_OCCURRED_AT,
  LEGACY_BACKFILL_QUANTITY,
} from "@/lib/collection-context/backfill";

/** Client falso: `$transaction` rechaza con el error dado (ejercita solo el catch de clasificación). */
const rejectingClient = (err: unknown): PrismaClient =>
  ({ $transaction: () => Promise.reject(err) }) as unknown as PrismaClient;

const knownPrisma = (code: string) => new Prisma.PrismaClientKnownRequestError(`test ${code}`, { code, clientVersion: "test" });

describe("F2.2 — buildLegacyBackfillFact", () => {
  it("clave estable por (userId, volumeId) con procedencia de backfill", () => {
    expect(legacyBackfillAcquisitionKey("u1", 42)).toBe("legacy-backfill:u1:42");
  });

  it("construye un fact determinístico y estable entre llamadas", () => {
    const a = buildLegacyBackfillFact("u1", 42);
    const b = buildLegacyBackfillFact("u1", 42);
    expect(a).toEqual(b);
    expect(a.acquisitionKey).toBe("legacy-backfill:u1:42");
    expect(a.userId).toBe("u1");
    expect(a.volumeId).toBe(42);
    expect(a.quantity).toBe(LEGACY_BACKFILL_QUANTITY);
    expect(a.quantity).toBe(1);
    expect(a.channel).toBe(ACQUISITION_CHANNEL.LEGACY_BACKFILL);
    expect(a.occurredAt.getTime()).toBe(LEGACY_BACKFILL_OCCURRED_AT.getTime());
    expect(a.occurredAt.getTime()).toBe(new Date("1970-01-01T00:00:00.000Z").getTime());
  });
});

describe("F2.2 — establishLegacyPresence: clasificación de errores (sin catch-all reintentable)", () => {
  const fact = buildLegacyBackfillFact("u1", 1);

  it("ACQUISITION_KEY_CONFLICT → CONFLICT", async () => {
    const c = rejectingClient(new CollectionError(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT));
    expect(await establishLegacyPresence(fact, c)).toBe(BACKFILL_RESULT.CONFLICT);
  });

  it("BackfillInconsistencyError → CONFLICT", async () => {
    const c = rejectingClient(new BackfillInconsistencyError(fact.acquisitionKey));
    expect(await establishLegacyPresence(fact, c)).toBe(BACKFILL_RESULT.CONFLICT);
  });

  it("P2003 (referencia requerida desaparecida) → TERMINAL", async () => {
    expect(await establishLegacyPresence(fact, rejectingClient(knownPrisma("P2003")))).toBe(BACKFILL_RESULT.TERMINAL);
  });

  it("P2034 (write conflict) y otros transitorios de la lista blanca → RETRYABLE", async () => {
    for (const code of ["P2034", "P1001", "P1002", "P1008", "P1017"]) {
      expect(await establishLegacyPresence(fact, rejectingClient(knownPrisma(code)))).toBe(BACKFILL_RESULT.RETRYABLE);
    }
  });

  it("código Prisma desconocido → NO se disimula: se relanza (aborta la corrida)", async () => {
    await expect(establishLegacyPresence(fact, rejectingClient(knownPrisma("P2010")))).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it("error inesperado (no Prisma, no dominio) → se relanza", async () => {
    await expect(establishLegacyPresence(fact, rejectingClient(new Error("boom")))).rejects.toThrow("boom");
  });

  it("otros CollectionError (no conflicto de clave) → se relanzan, no se enmascaran", async () => {
    const c = rejectingClient(new CollectionError(COLLECTION_ERROR.INVALID_QUANTITY));
    await expect(establishLegacyPresence(fact, c)).rejects.toBeInstanceOf(CollectionError);
  });
});
