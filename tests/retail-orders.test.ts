import { describe, it, expect } from "vitest";
import {
  ORDER_STATUS, MAX_LINE_QUANTITY, MAX_SAFE_TOTAL_CENTS,
  canTransitionOrder, assertValidQuantity, consolidateRequestedLines,
  computeLineTotalCents, computeOrderTotalCents, assertExpectedTotal,
  canCustomerCancel, assertCustomerCancellable, canStoreCancel, assertStoreCancellable,
} from "@/lib/domain/retail/order";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { derivePrefix, generatePublicCode } from "@/lib/retail/publicCode";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};

// ---------------------------------------------------------------------------
// Máquina de estados de la orden
// ---------------------------------------------------------------------------
describe("order state machine", () => {
  it("RESERVED→CANCELLED permitido; todo lo demás no", () => {
    expect(canTransitionOrder("RESERVED", "CANCELLED")).toBe(true);
    expect(canTransitionOrder("CANCELLED", "RESERVED")).toBe(false); // cancelar es definitivo
    expect(canTransitionOrder("RESERVED", "RESERVED")).toBe(false);
    expect(canTransitionOrder("CANCELLED", "CANCELLED")).toBe(false);
  });
  it("nace en RESERVED (default del dominio)", () => expect(ORDER_STATUS.RESERVED).toBe("RESERVED"));
});

// ---------------------------------------------------------------------------
// Cancelabilidad
// ---------------------------------------------------------------------------
describe("cancelability", () => {
  it("cliente: solo RESERVED y con campaña abierta", () => {
    expect(canCustomerCancel("RESERVED", true)).toBe(true);
    expect(canCustomerCancel("RESERVED", false)).toBe(false); // campaña cerrada
    expect(canCustomerCancel("CANCELLED", true)).toBe(false);
    expect(code(() => assertCustomerCancellable("RESERVED", false))).toBe(RETAIL_ERROR.ORDER_NOT_CANCELLABLE);
    expect(code(() => assertCustomerCancellable("CANCELLED", true))).toBe(RETAIL_ERROR.ORDER_NOT_CANCELLABLE);
  });
  it("tienda: cualquier RESERVED (incluso campaña cerrada); nunca una ya cancelada", () => {
    expect(canStoreCancel("RESERVED")).toBe(true);
    expect(canStoreCancel("CANCELLED")).toBe(false);
    expect(code(() => assertStoreCancellable("CANCELLED"))).toBe(RETAIL_ERROR.ORDER_NOT_CANCELLABLE); // no cancelar dos veces
    expect(code(() => assertStoreCancellable("RESERVED"))).toBe("NO_THROW");
  });
});

// ---------------------------------------------------------------------------
// Cantidades y consolidación
// ---------------------------------------------------------------------------
describe("quantities", () => {
  it("entero en [1, MAX]", () => {
    expect(code(() => assertValidQuantity(1))).toBe("NO_THROW");
    expect(code(() => assertValidQuantity(MAX_LINE_QUANTITY))).toBe("NO_THROW");
    expect(code(() => assertValidQuantity(0))).toBe(RETAIL_ERROR.INVALID_QUANTITY);
    expect(code(() => assertValidQuantity(-3))).toBe(RETAIL_ERROR.INVALID_QUANTITY);
    expect(code(() => assertValidQuantity(2.5))).toBe(RETAIL_ERROR.INVALID_QUANTITY);
    expect(code(() => assertValidQuantity(MAX_LINE_QUANTITY + 1))).toBe(RETAIL_ERROR.TOO_MANY_ITEMS);
  });
  it("consolida ofertas repetidas sumando cantidades", () => {
    const m = consolidateRequestedLines([{ offerId: 7, quantity: 2 }, { offerId: 9, quantity: 1 }, { offerId: 7, quantity: 3 }]);
    expect(m.get(7)).toBe(5);
    expect(m.get(9)).toBe(1);
    expect(m.size).toBe(2);
  });
  it("el máximo se aplica DESPUÉS de consolidar", () => {
    // 12 + 12 = 24 > 20 aunque cada línea sea válida por separado
    expect(code(() => consolidateRequestedLines([{ offerId: 1, quantity: 12 }, { offerId: 1, quantity: 12 }]))).toBe(RETAIL_ERROR.TOO_MANY_ITEMS);
  });
  it("rechaza lista vacía y cantidades inválidas por línea", () => {
    expect(code(() => consolidateRequestedLines([]))).toBe(RETAIL_ERROR.EMPTY_ORDER);
    expect(code(() => consolidateRequestedLines([{ offerId: 1, quantity: 0 }]))).toBe(RETAIL_ERROR.INVALID_QUANTITY);
  });
});

// ---------------------------------------------------------------------------
// Precios y totales (servidor)
// ---------------------------------------------------------------------------
describe("totals", () => {
  it("total de línea = preventa × cantidad", () => {
    expect(computeLineTotalCents(70000, 3)).toBe(210000);
    expect(computeLineTotalCents(0, 5)).toBe(0);
  });
  it("total de orden = suma de líneas", () => {
    expect(computeOrderTotalCents([210000, 90000, 0])).toBe(300000);
    expect(computeOrderTotalCents([])).toBe(0);
  });
  it("guarda contra overflow (línea y orden)", () => {
    expect(code(() => computeLineTotalCents(MAX_SAFE_TOTAL_CENTS, 20))).toBe(RETAIL_ERROR.INVALID_PRICE);
    expect(code(() => computeOrderTotalCents([MAX_SAFE_TOTAL_CENTS, MAX_SAFE_TOTAL_CENTS]))).toBe(RETAIL_ERROR.INVALID_PRICE);
    expect(code(() => computeLineTotalCents(-1, 1))).toBe(RETAIL_ERROR.INVALID_PRICE);
  });
  it("verifica total esperado del cliente (o lo ignora si es null)", () => {
    expect(code(() => assertExpectedTotal(300000, 300000))).toBe("NO_THROW");
    expect(code(() => assertExpectedTotal(null, 300000))).toBe("NO_THROW");
    expect(code(() => assertExpectedTotal(1, 300000))).toBe(RETAIL_ERROR.ORDER_TOTAL_MISMATCH);
  });
});

// ---------------------------------------------------------------------------
// publicCode
// ---------------------------------------------------------------------------
describe("publicCode", () => {
  it("prefijo estable de 3 chars derivado del slug (neutral si no alcanza)", () => {
    expect(derivePrefix("crumb")).toBe("CRU");
    expect(derivePrefix("la-comiqueria")).toBe("LAC");
    expect(derivePrefix("x")).toBe("XPR"); // relleno neutral
    expect(derivePrefix("")).toBe("PRV");
  });
  it("formato PREFIJO-CUERPO, cuerpo sin caracteres ambiguos", () => {
    const codeStr = generatePublicCode("crumb");
    expect(codeStr).toMatch(/^CRU-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    // no reusa un nombre real hardcodeado ni es secuencial
    expect(generatePublicCode("crumb")).not.toBe(generatePublicCode("crumb"));
  });
});
