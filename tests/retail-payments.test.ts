import { describe, it, expect } from "vitest";
import {
  PAYMENT_STATUS, PAYMENT_METHOD, MAX_SAFE_TOTAL_CENTS,
  assertValidAmount, assertValidMethod, assertRegisterable, assertCancellableWithoutPayments,
  sanitizePaymentNote, computePaidCents, computeRemainingCents, derivePaymentStatus, reconcilePaymentKey,
  type ExistingPaymentView, type PaymentPayload,
} from "@/lib/domain/retail/payment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};

// ---------------------------------------------------------------------------
// Derivación de estado de pago
// ---------------------------------------------------------------------------
describe("derivePaymentStatus", () => {
  it("los cuatro estados contra el total", () => {
    expect(derivePaymentStatus(1000, 0)).toBe(PAYMENT_STATUS.UNPAID);
    expect(derivePaymentStatus(1000, 400)).toBe(PAYMENT_STATUS.PARTIALLY_PAID);
    expect(derivePaymentStatus(1000, 1000)).toBe(PAYMENT_STATUS.PAID);
    expect(derivePaymentStatus(1000, 1500)).toBe(PAYMENT_STATUS.OVERPAID);
  });
  it("borde total === 0: pagado 0 → PAID (nada que cobrar); pagado > 0 → OVERPAID", () => {
    expect(derivePaymentStatus(0, 0)).toBe(PAYMENT_STATUS.PAID);
    expect(derivePaymentStatus(0, 100)).toBe(PAYMENT_STATUS.OVERPAID);
  });
});

// ---------------------------------------------------------------------------
// Cálculo de pagado / restante
// ---------------------------------------------------------------------------
describe("cálculo de pagado / restante", () => {
  it("computePaidCents suma (solo se le pasan CONFIRMED desde el servicio)", () => {
    expect(computePaidCents([])).toBe(0);
    expect(computePaidCents([200, 300, 500])).toBe(1000);
  });
  it("computePaidCents rechaza desborde", () => {
    expect(code(() => computePaidCents([MAX_SAFE_TOTAL_CENTS, 1]))).toBe(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT);
  });
  it("computeRemainingCents con piso en cero (el sobrepago no lo vuelve negativo)", () => {
    expect(computeRemainingCents(1000, 400)).toBe(600);
    expect(computeRemainingCents(1000, 1500)).toBe(0);
    expect(computeRemainingCents(1000, 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------
describe("validaciones", () => {
  it("assertValidAmount: entero ≥ 1, sin cero/negativo/decimal, con techo", () => {
    expect(code(() => assertValidAmount(1))).toBe("NO_THROW");
    expect(code(() => assertValidAmount(0))).toBe(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT);
    expect(code(() => assertValidAmount(-5))).toBe(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT);
    expect(code(() => assertValidAmount(12.5))).toBe(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT);
    expect(code(() => assertValidAmount(MAX_SAFE_TOTAL_CENTS + 1))).toBe(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT);
  });
  it("assertValidMethod: enum cerrado", () => {
    expect(code(() => assertValidMethod(PAYMENT_METHOD.TRANSFER))).toBe("NO_THROW");
    expect(code(() => assertValidMethod(PAYMENT_METHOD.MERCADOPAGO))).toBe("NO_THROW");
    expect(code(() => assertValidMethod("CRYPTO"))).toBe(RETAIL_ERROR.INVALID_PAYMENT_METHOD);
  });
  it("assertRegisterable rechaza orden CANCELLED", () => {
    expect(code(() => assertRegisterable("RESERVED"))).toBe("NO_THROW");
    expect(code(() => assertRegisterable("CANCELLED"))).toBe(RETAIL_ERROR.ORDER_CANCELLED);
  });
  it("assertCancellableWithoutPayments rechaza si hay pagos", () => {
    expect(code(() => assertCancellableWithoutPayments(0))).toBe("NO_THROW");
    expect(code(() => assertCancellableWithoutPayments(1))).toBe(RETAIL_ERROR.ORDER_HAS_PAYMENTS);
  });
  it("sanitizePaymentNote: sin HTML, recorta, vacío → null", () => {
    expect(sanitizePaymentNote("  <b>ref 123</b>  ")).toBe("bref 123/b");
    expect(sanitizePaymentNote("   ")).toBeNull();
    expect(sanitizePaymentNote("<>")).toBeNull();
    expect(sanitizePaymentNote(null)).toBeNull();
    expect(sanitizePaymentNote("x".repeat(600))?.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Idempotencia / reconciliación de la clave
// ---------------------------------------------------------------------------
describe("reconcilePaymentKey", () => {
  const base: PaymentPayload = { orderId: 7, amountCents: 500, method: "TRANSFER", paidAtMs: 1000, note: "ref" };
  const existing = (over: Partial<ExistingPaymentView> = {}): ExistingPaymentView => ({ id: 1, orderId: 7, amountCents: 500, method: "TRANSFER", paidAtMs: 1000, note: "ref", ...over });

  it("sin dueño → false (registrar)", () => {
    expect(reconcilePaymentKey(null, base)).toBe(false);
  });
  it("mismo payload → true (idempotente)", () => {
    expect(reconcilePaymentKey(existing(), base)).toBe(true);
  });
  it("conflicto por orderId / monto / método / fecha / nota", () => {
    expect(code(() => reconcilePaymentKey(existing({ orderId: 8 }), base))).toBe(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT);
    expect(code(() => reconcilePaymentKey(existing({ amountCents: 600 }), base))).toBe(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT);
    expect(code(() => reconcilePaymentKey(existing({ method: "CASH" }), base))).toBe(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT);
    expect(code(() => reconcilePaymentKey(existing({ paidAtMs: 2000 }), base))).toBe(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT);
    expect(code(() => reconcilePaymentKey(existing({ note: "otra" }), base))).toBe(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT);
  });
  it("nota null en ambos → idempotente", () => {
    expect(reconcilePaymentKey(existing({ note: null }), { ...base, note: null })).toBe(true);
  });
});
