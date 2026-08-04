import { describe, it, expect } from "vitest";
import { buildReorderPlan } from "@/lib/domain/retail/offer";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};

describe("buildReorderPlan · permutación válida", () => {
  it("asigna sortOrder = índice en el orden pedido", () => {
    expect(buildReorderPlan([1, 2, 3], [3, 1, 2])).toEqual([
      { offerId: 3, sortOrder: 0 },
      { offerId: 1, sortOrder: 1 },
      { offerId: 2, sortOrder: 2 },
    ]);
  });

  it("conjunto vacío → plan vacío", () => {
    expect(buildReorderPlan([], [])).toEqual([]);
  });

  it("idempotente: el mismo orden reasigna los mismos índices", () => {
    expect(buildReorderPlan([1, 2, 3], [1, 2, 3])).toEqual([
      { offerId: 1, sortOrder: 0 },
      { offerId: 2, sortOrder: 1 },
      { offerId: 3, sortOrder: 2 },
    ]);
  });
});

describe("buildReorderPlan · validación del conjunto", () => {
  it("longitud distinta (falta una) → INVALID_REORDER_SET", () => {
    expect(code(() => buildReorderPlan([1, 2, 3], [1, 2]))).toBe(RETAIL_ERROR.INVALID_REORDER_SET);
  });

  it("longitud distinta (sobra una) → INVALID_REORDER_SET", () => {
    expect(code(() => buildReorderPlan([1, 2], [1, 2, 3]))).toBe(RETAIL_ERROR.INVALID_REORDER_SET);
  });

  it("id duplicado → INVALID_REORDER_SET", () => {
    expect(code(() => buildReorderPlan([1, 2, 3], [1, 2, 2]))).toBe(RETAIL_ERROR.INVALID_REORDER_SET);
  });

  it("id ajeno a la campaña → INVALID_REORDER_SET", () => {
    expect(code(() => buildReorderPlan([1, 2, 3], [1, 2, 99]))).toBe(RETAIL_ERROR.INVALID_REORDER_SET);
  });
});
