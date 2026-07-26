import { describe, it, expect } from "vitest";
import {
  ORDER_HANDOFF,
  preparableQuantity, pickupableQuantity, pendingArrivalQuantity,
  applyPrepared, applyPickedUp, deriveHandoffLine, isLineComplete, getOrderHandoffSummary,
  type HandoffCounters,
} from "@/lib/domain/retail/handoff";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};
/** Contadores de línea (defaults en 0). */
const c = (o: Partial<HandoffCounters> = {}): HandoffCounters => ({ quantity: 5, arrivedQuantity: 0, cancelledQuantity: 0, preparedQuantity: 0, pickedUpQuantity: 0, ...o });

// ---------------------------------------------------------------------------
// Cantidades derivadas
// ---------------------------------------------------------------------------
describe("cantidades derivadas", () => {
  it("preparable / pickupable / pendingArrival", () => {
    const x = c({ quantity: 5, arrivedQuantity: 4, cancelledQuantity: 1, preparedQuantity: 2, pickedUpQuantity: 1 });
    expect(preparableQuantity(x)).toBe(2); // 4 − 2
    expect(pickupableQuantity(x)).toBe(1); // 2 − 1
    expect(pendingArrivalQuantity(x)).toBe(0); // 5 − 4 − 1
  });
  it("pendingArrival con nada llegado", () => {
    expect(pendingArrivalQuantity(c({ quantity: 5 }))).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// applyPrepared
// ---------------------------------------------------------------------------
describe("applyPrepared", () => {
  it("preparación válida (delta) sube prepared", () => {
    expect(applyPrepared(c({ arrivedQuantity: 3 }), 2).preparedQuantity).toBe(2);
  });
  it("rechaza cantidad cero / negativa / decimal", () => {
    expect(code(() => applyPrepared(c({ arrivedQuantity: 3 }), 0))).toBe(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY);
    expect(code(() => applyPrepared(c({ arrivedQuantity: 3 }), -1))).toBe(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY);
    expect(code(() => applyPrepared(c({ arrivedQuantity: 3 }), 1.5))).toBe(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY);
  });
  it("nada para preparar (arrived == prepared)", () => {
    expect(code(() => applyPrepared(c({ arrivedQuantity: 2, preparedQuantity: 2 }), 1))).toBe(RETAIL_ERROR.NOTHING_TO_PREPARE);
  });
  it("preparar por encima de lo llegado", () => {
    expect(code(() => applyPrepared(c({ arrivedQuantity: 2, preparedQuantity: 1 }), 2))).toBe(RETAIL_ERROR.PREPARATION_EXCEEDS_ARRIVED);
  });
});

// ---------------------------------------------------------------------------
// applyPickedUp
// ---------------------------------------------------------------------------
describe("applyPickedUp", () => {
  it("retiro válido (delta) sube pickedUp", () => {
    expect(applyPickedUp(c({ arrivedQuantity: 3, preparedQuantity: 3 }), 2).pickedUpQuantity).toBe(2);
  });
  it("rechaza cantidad inválida", () => {
    expect(code(() => applyPickedUp(c({ preparedQuantity: 2 }), 0))).toBe(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY);
    expect(code(() => applyPickedUp(c({ preparedQuantity: 2 }), 2.2))).toBe(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY);
  });
  it("nada para retirar (prepared == pickedUp)", () => {
    expect(code(() => applyPickedUp(c({ preparedQuantity: 2, pickedUpQuantity: 2 }), 1))).toBe(RETAIL_ERROR.NOTHING_TO_PICKUP);
  });
  it("retirar por encima de lo preparado", () => {
    expect(code(() => applyPickedUp(c({ preparedQuantity: 2, pickedUpQuantity: 1 }), 2))).toBe(RETAIL_ERROR.PICKUP_EXCEEDS_PREPARED);
  });
});

// ---------------------------------------------------------------------------
// Flags de línea / lineComplete
// ---------------------------------------------------------------------------
describe("deriveHandoffLine / lineComplete", () => {
  it("flags con retiro parcial (arrived5, prepared5, pickedUp2)", () => {
    const v = deriveHandoffLine(c({ arrivedQuantity: 5, preparedQuantity: 5, pickedUpQuantity: 2 }));
    expect(v).toMatchObject({ preparableQuantity: 0, pickupableQuantity: 3, pendingArrivalQuantity: 0, hasUnprepared: false, hasReadyToPickup: true, hasPickedUp: true, lineComplete: false });
  });
  it("todo lo llegado retirado PERO quedan por llegar → NO lineComplete", () => {
    const x = c({ quantity: 5, arrivedQuantity: 2, preparedQuantity: 2, pickedUpQuantity: 2 });
    expect(isLineComplete(x)).toBe(false); // A+C=2 ≠ Q=5
    expect(deriveHandoffLine(x).pendingArrivalQuantity).toBe(3);
  });
  it("orden completamente resuelta (arrived + cancelled == quantity, todo retirado) → lineComplete", () => {
    expect(isLineComplete(c({ quantity: 5, arrivedQuantity: 3, cancelledQuantity: 2, preparedQuantity: 3, pickedUpQuantity: 3 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Estado de orden (los 4 valores + bordes)
// ---------------------------------------------------------------------------
describe("getOrderHandoffSummary", () => {
  it("NOT_STARTED: nada llegó/preparó/retiró", () => {
    expect(getOrderHandoffSummary([c({ quantity: 5 })])).toBe(ORDER_HANDOFF.NOT_STARTED);
  });
  it("IN_PROGRESS: llegó pero nada preparado (nada listo)", () => {
    expect(getOrderHandoffSummary([c({ quantity: 5, arrivedQuantity: 3 })])).toBe(ORDER_HANDOFF.IN_PROGRESS);
  });
  it("IN_PROGRESS: todo lo llegado retirado pero quedan por llegar (Ejemplo B)", () => {
    expect(getOrderHandoffSummary([c({ quantity: 5, arrivedQuantity: 2, preparedQuantity: 2, pickedUpQuantity: 2 })])).toBe(ORDER_HANDOFF.IN_PROGRESS);
  });
  it("READY_FOR_PICKUP: hay preparado sin retirar (Ejemplo A)", () => {
    expect(getOrderHandoffSummary([c({ quantity: 5, arrivedQuantity: 5, preparedQuantity: 5, pickedUpQuantity: 2 })])).toBe(ORDER_HANDOFF.READY_FOR_PICKUP);
  });
  it("COMPLETED: todo resuelto y todo lo llegado retirado", () => {
    expect(getOrderHandoffSummary([c({ quantity: 5, arrivedQuantity: 5, preparedQuantity: 5, pickedUpQuantity: 5 })])).toBe(ORDER_HANDOFF.COMPLETED);
  });
  it("COMPLETED: con cancelación parcial del pending y el resto retirado", () => {
    expect(getOrderHandoffSummary([c({ quantity: 5, arrivedQuantity: 3, cancelledQuantity: 2, preparedQuantity: 3, pickedUpQuantity: 3 })])).toBe(ORDER_HANDOFF.COMPLETED);
  });
  it("agrega varias líneas (mezcla → READY_FOR_PICKUP)", () => {
    const done = c({ quantity: 2, arrivedQuantity: 2, preparedQuantity: 2, pickedUpQuantity: 2 });
    const ready = c({ quantity: 3, arrivedQuantity: 3, preparedQuantity: 3, pickedUpQuantity: 0 });
    expect(getOrderHandoffSummary([done, ready])).toBe(ORDER_HANDOFF.READY_FOR_PICKUP);
  });
});
