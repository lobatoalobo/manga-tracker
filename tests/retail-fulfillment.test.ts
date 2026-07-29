import { describe, it, expect } from "vitest";
import {
  FULFILLMENT_STATUS, ORDER_FULFILLMENT, LINE_EVENT_TYPE,
  pendingQuantity, reservedNotOrdered, deriveFulfillmentStatus,
  applyOrdered, applyArrived, applyCancelled, hasFulfillmentStarted, assertNoFulfillmentStarted,
  getOrderFulfillmentSummary, reconcileOperationKey, type LineCounters,
} from "@/lib/domain/retail/fulfillment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};
const c = (quantity: number, ordered = 0, arrived = 0, cancelled = 0): LineCounters => ({ quantity, orderedQuantity: ordered, arrivedQuantity: arrived, cancelledQuantity: cancelled });

// ---------------------------------------------------------------------------
// Derivación de estado
// ---------------------------------------------------------------------------
describe("deriveFulfillmentStatus", () => {
  it("RESERVED sin actividad", () => expect(deriveFulfillmentStatus(c(5))).toBe(FULFILLMENT_STATUS.RESERVED));
  it("ORDERED con pedido o llegada parcial", () => {
    expect(deriveFulfillmentStatus(c(5, 3, 0, 0))).toBe(FULFILLMENT_STATUS.ORDERED);
    expect(deriveFulfillmentStatus(c(5, 3, 2, 0))).toBe(FULFILLMENT_STATUS.ORDERED); // parcialmente llegado sigue ORDERED
  });
  it("ARRIVED cuando todo resuelto con al menos una llegada", () => {
    expect(deriveFulfillmentStatus(c(5, 5, 5, 0))).toBe(FULFILLMENT_STATUS.ARRIVED);
    expect(deriveFulfillmentStatus(c(5, 3, 3, 2))).toBe(FULFILLMENT_STATUS.ARRIVED); // 3 llegaron + 2 cancel = 5
  });
  it("CANCELLED cuando todo cancelado", () => expect(deriveFulfillmentStatus(c(5, 0, 0, 5))).toBe(FULFILLMENT_STATUS.CANCELLED));
});

// ---------------------------------------------------------------------------
// Derivaciones de cantidad
// ---------------------------------------------------------------------------
describe("derivaciones", () => {
  it("pendingQuantity = quantity - arrived - cancelled", () => {
    expect(pendingQuantity(c(5, 3, 2, 1))).toBe(2);
    expect(pendingQuantity(c(5, 0, 0, 0))).toBe(5);
  });
  it("reservedNotOrdered = quantity - cancelled - ordered", () => {
    expect(reservedNotOrdered(c(5, 2, 0, 1))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Operaciones con cantidades parciales
// ---------------------------------------------------------------------------
describe("applyOrdered", () => {
  it("pedido parcial acumula", () => {
    let x = applyOrdered(c(5), 2);
    expect(x.orderedQuantity).toBe(2);
    x = applyOrdered(x, 3);
    expect(x.orderedQuantity).toBe(5);
  });
  it("no excede lo reservado-sin-pedir", () => {
    expect(code(() => applyOrdered(c(5, 4), 2))).toBe(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY);
    expect(code(() => applyOrdered(c(5, 5), 1))).toBe(RETAIL_ERROR.NOTHING_PENDING);
  });
  it("rechaza cantidades no positivas", () => {
    expect(code(() => applyOrdered(c(5), 0))).toBe(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY);
    expect(code(() => applyOrdered(c(5), 1.5))).toBe(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY);
  });
});

describe("applyArrived", () => {
  it("llegada parcial acumula hasta completar", () => {
    let x = applyArrived(c(5, 5), 3);
    expect(x.arrivedQuantity).toBe(3);
    x = applyArrived(x, 2);
    expect(x.arrivedQuantity).toBe(5);
    expect(deriveFulfillmentStatus(x)).toBe(FULFILLMENT_STATUS.ARRIVED);
  });
  it("llegada directa sube ordered (auto-pedido)", () => {
    const x = applyArrived(c(5), 4); // sin pedir antes
    expect(x.arrivedQuantity).toBe(4);
    expect(x.orderedQuantity).toBe(4); // ordered subió a la par
  });
  it("no excede lo pendiente", () => {
    expect(code(() => applyArrived(c(5, 5, 3), 3))).toBe(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY);
    expect(code(() => applyArrived(c(5, 5, 5), 1))).toBe(RETAIL_ERROR.NOTHING_PENDING);
  });
});

describe("applyCancelled", () => {
  it("cancela pendientes y baja ordered en tránsito (clamp)", () => {
    const x = applyCancelled(c(5, 5, 0, 0), 2); // ordered 5, cancel 2
    expect(x.cancelledQuantity).toBe(2);
    expect(x.orderedQuantity).toBe(3); // clamp a quantity - cancelled
  });
  it("no cancela lo ya llegado", () => {
    expect(code(() => applyCancelled(c(5, 5, 3), 3))).toBe(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY); // pending = 2
    expect(code(() => applyCancelled(c(5, 0, 5), 1))).toBe(RETAIL_ERROR.NOTHING_PENDING);
  });
  it("cancelar todo → CANCELLED", () => {
    const x = applyCancelled(c(3), 3);
    expect(deriveFulfillmentStatus(x)).toBe(FULFILLMENT_STATUS.CANCELLED);
  });
});

// ---------------------------------------------------------------------------
// Inicio de fulfillment (cancelación de orden)
// ---------------------------------------------------------------------------
describe("hasFulfillmentStarted / assertNoFulfillmentStarted", () => {
  it("detecta pedido o llegada", () => {
    expect(hasFulfillmentStarted(c(5))).toBe(false);
    expect(hasFulfillmentStarted(c(5, 1))).toBe(true);
    expect(hasFulfillmentStarted(c(5, 0, 1))).toBe(true);
  });
  it("assert lanza ORDER_FULFILLMENT_STARTED si alguna línea empezó", () => {
    expect(code(() => assertNoFulfillmentStarted([c(5), c(3)]))).toBe("NO_THROW");
    expect(code(() => assertNoFulfillmentStarted([c(5), c(3, 1)]))).toBe(RETAIL_ERROR.ORDER_FULFILLMENT_STARTED);
  });
});

// ---------------------------------------------------------------------------
// Resumen de orden
// ---------------------------------------------------------------------------
describe("getOrderFulfillmentSummary", () => {
  it("NOT_STARTED sin actividad", () => expect(getOrderFulfillmentSummary([c(5), c(3)])).toBe(ORDER_FULFILLMENT.NOT_STARTED));
  it("IN_PROGRESS con algo pedido/llegado pero pendiente", () => {
    expect(getOrderFulfillmentSummary([c(5, 3, 1), c(3)])).toBe(ORDER_FULFILLMENT.IN_PROGRESS);
  });
  it("FULLY_ARRIVED cuando todo llegó", () => expect(getOrderFulfillmentSummary([c(5, 5, 5), c(2, 2, 2)])).toBe(ORDER_FULFILLMENT.FULLY_ARRIVED));
  it("FULLY_CANCELLED cuando todo cancelado", () => expect(getOrderFulfillmentSummary([c(5, 0, 0, 5), c(2, 0, 0, 2)])).toBe(ORDER_FULFILLMENT.FULLY_CANCELLED));
  it("PARTIALLY_CANCELLED cuando todo resuelto con mezcla", () => {
    expect(getOrderFulfillmentSummary([c(5, 3, 3, 2)])).toBe(ORDER_FULFILLMENT.PARTIALLY_CANCELLED); // 3 llegaron + 2 cancel
  });
});

// ---------------------------------------------------------------------------
// Reconciliación de operationKey (idempotencia vs conflicto)
// ---------------------------------------------------------------------------
describe("reconcileOperationKey", () => {
  const expected = { orderLineId: 10, type: LINE_EVENT_TYPE.MARKED_ARRIVED, quantity: 2 };
  it("sin evento previo → false (aplicar)", () => {
    expect(reconcileOperationKey(null, expected)).toBe(false);
  });
  it("misma línea + tipo + cantidad → true (idempotente)", () => {
    expect(reconcileOperationKey({ orderLineId: 10, type: "MARKED_ARRIVED", quantity: 2 }, expected)).toBe(true);
  });
  it("misma key, cantidad distinta → OPERATION_KEY_CONFLICT", () => {
    expect(code(() => reconcileOperationKey({ orderLineId: 10, type: "MARKED_ARRIVED", quantity: 3 }, expected))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
  });
  it("misma key, tipo distinto → OPERATION_KEY_CONFLICT", () => {
    expect(code(() => reconcileOperationKey({ orderLineId: 10, type: "MARKED_ORDERED", quantity: 2 }, expected))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
  });
  it("misma key, otra línea → OPERATION_KEY_CONFLICT (unicidad global)", () => {
    expect(code(() => reconcileOperationKey({ orderLineId: 11, type: "MARKED_ARRIVED", quantity: 2 }, expected))).toBe(RETAIL_ERROR.OPERATION_KEY_CONFLICT);
  });
});
