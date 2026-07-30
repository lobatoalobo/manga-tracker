import { describe, it, expect } from "vitest";
import {
  ACQUISITION_CHANNEL,
  assertValidAcquisition, samePayload, reconcileAcquisition,
  type AcquisitionFact,
} from "@/lib/domain/collection/acquisition";
import { applyAcquisition, reconstructQuantity } from "@/lib/domain/collection/position";
import { PROJECTION_RESULT } from "@/lib/domain/collection/result";
import { CollectionError, COLLECTION_ERROR } from "@/lib/domain/collection/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof CollectionError ? e.code : "WRONG"; }
};
/** Hecho válido de base; se sobreescriben campos por test. */
const fact = (o: Partial<AcquisitionFact> = {}): AcquisitionFact => ({
  acquisitionKey: "retail-pickup:k1",
  userId: "u1",
  volumeId: 10,
  quantity: 2,
  channel: ACQUISITION_CHANNEL.RETAIL_PICKUP,
  occurredAt: new Date("2026-08-01T10:00:00Z"),
  ...o,
});

// ---------------------------------------------------------------------------
// assertValidAcquisition
// ---------------------------------------------------------------------------
describe("assertValidAcquisition", () => {
  it("acepta un hecho bien formado", () => {
    expect(code(() => assertValidAcquisition(fact()))).toBe("NO_THROW");
  });
  it("rechaza cantidad cero / negativa / decimal", () => {
    expect(code(() => assertValidAcquisition(fact({ quantity: 0 })))).toBe(COLLECTION_ERROR.INVALID_QUANTITY);
    expect(code(() => assertValidAcquisition(fact({ quantity: -1 })))).toBe(COLLECTION_ERROR.INVALID_QUANTITY);
    expect(code(() => assertValidAcquisition(fact({ quantity: 1.5 })))).toBe(COLLECTION_ERROR.INVALID_QUANTITY);
  });
  it("rechaza clave / usuario / canal vacíos", () => {
    expect(code(() => assertValidAcquisition(fact({ acquisitionKey: "" })))).toBe(COLLECTION_ERROR.INVALID_ACQUISITION);
    expect(code(() => assertValidAcquisition(fact({ userId: "  " })))).toBe(COLLECTION_ERROR.INVALID_ACQUISITION);
    expect(code(() => assertValidAcquisition(fact({ channel: "" })))).toBe(COLLECTION_ERROR.INVALID_ACQUISITION);
  });
  it("rechaza volumeId inválido y occurredAt inválido", () => {
    expect(code(() => assertValidAcquisition(fact({ volumeId: 0 })))).toBe(COLLECTION_ERROR.INVALID_ACQUISITION);
    expect(code(() => assertValidAcquisition(fact({ volumeId: 1.2 })))).toBe(COLLECTION_ERROR.INVALID_ACQUISITION);
    expect(code(() => assertValidAcquisition(fact({ occurredAt: new Date("nope") })))).toBe(COLLECTION_ERROR.INVALID_ACQUISITION);
  });
});

// ---------------------------------------------------------------------------
// applyAcquisition (comportamiento del agregado)
// ---------------------------------------------------------------------------
describe("applyAcquisition", () => {
  it("suma la cantidad del hecho a la posición actual", () => {
    expect(applyAcquisition(0, fact({ quantity: 2 }))).toBe(2);
    expect(applyAcquisition(3, fact({ quantity: 5 }))).toBe(8);
  });
  it("append-only: la posición sólo crece", () => {
    const next = applyAcquisition(4, fact({ quantity: 1 }));
    expect(next).toBeGreaterThan(4);
  });
  it("rechaza un hecho con cantidad inválida (delega en assertValidAcquisition)", () => {
    expect(code(() => applyAcquisition(0, fact({ quantity: 0 })))).toBe(COLLECTION_ERROR.INVALID_QUANTITY);
  });
  it("rechaza una cantidad actual inválida (negativa / no entera)", () => {
    expect(code(() => applyAcquisition(-1, fact()))).toBe(COLLECTION_ERROR.NEGATIVE_POSITION);
    expect(code(() => applyAcquisition(2.5, fact()))).toBe(COLLECTION_ERROR.NEGATIVE_POSITION);
  });
});

// ---------------------------------------------------------------------------
// reconstructQuantity
// ---------------------------------------------------------------------------
describe("reconstructQuantity", () => {
  it("Σ de las cantidades", () => {
    expect(reconstructQuantity([fact({ quantity: 2 }), fact({ quantity: 3 }), fact({ quantity: 5 })])).toBe(10);
  });
  it("sin hechos → 0", () => {
    expect(reconstructQuantity([])).toBe(0);
  });
  it("propaga un hecho inválido", () => {
    expect(code(() => reconstructQuantity([fact(), fact({ quantity: 0 })]))).toBe(COLLECTION_ERROR.INVALID_QUANTITY);
  });
});

// ---------------------------------------------------------------------------
// samePayload — los cinco atributos de dominio (recordedAt excluido)
// ---------------------------------------------------------------------------
describe("samePayload", () => {
  it("igual en los cinco atributos → true", () => {
    expect(samePayload(fact(), fact())).toBe(true);
  });
  it("distinto en cualquiera de los cinco → false", () => {
    expect(samePayload(fact(), fact({ userId: "u2" }))).toBe(false);
    expect(samePayload(fact(), fact({ volumeId: 11 }))).toBe(false);
    expect(samePayload(fact(), fact({ quantity: 3 }))).toBe(false);
    expect(samePayload(fact(), fact({ channel: "OTHER" }))).toBe(false);
    expect(samePayload(fact(), fact({ occurredAt: new Date("2026-08-01T10:00:01Z") }))).toBe(false);
  });
  it("misma acquisitionKey distinta NO afecta (no se compara)", () => {
    expect(samePayload(fact({ acquisitionKey: "a" }), fact({ acquisitionKey: "b" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reconcileAcquisition
// ---------------------------------------------------------------------------
describe("reconcileAcquisition", () => {
  it("sin hecho previo → false (hay que insertar)", () => {
    expect(reconcileAcquisition(null, fact())).toBe(false);
  });
  it("hecho previo con mismo payload → true (idempotente)", () => {
    expect(reconcileAcquisition(fact(), fact())).toBe(true);
  });
  it("conflicto por cualquiera de los cinco campos → ACQUISITION_KEY_CONFLICT", () => {
    expect(code(() => reconcileAcquisition(fact({ userId: "u2" }), fact()))).toBe(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT);
    expect(code(() => reconcileAcquisition(fact({ volumeId: 11 }), fact()))).toBe(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT);
    expect(code(() => reconcileAcquisition(fact({ quantity: 3 }), fact()))).toBe(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT);
    expect(code(() => reconcileAcquisition(fact({ channel: "OTHER" }), fact()))).toBe(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT);
    expect(code(() => reconcileAcquisition(fact({ occurredAt: new Date("2026-08-01T11:00:00Z") }), fact()))).toBe(COLLECTION_ERROR.ACQUISITION_KEY_CONFLICT);
  });
});

// ---------------------------------------------------------------------------
// PROJECTION_RESULT — vocabulario de resultados
// ---------------------------------------------------------------------------
describe("PROJECTION_RESULT", () => {
  it("expone los siete resultados esperables (incl. PENDING_CATALOG_RESOLUTION)", () => {
    expect(Object.values(PROJECTION_RESULT).sort()).toEqual(
      ["ALREADY_APPLIED", "APPLIED", "CONFLICT", "CORRUPT_SOURCE", "PENDING_CATALOG_RESOLUTION", "RETRYABLE_FAILURE", "TERMINALLY_NOT_APPLICABLE"],
    );
  });
});
