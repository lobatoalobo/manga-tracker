import { describe, it, expect } from "vitest";
import { assertPrincipalEligible } from "@/lib/domain/retail/offer";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};
const base = { campaignId: 1, status: "ACTIVE" as const, onCover: true };

describe("assertPrincipalEligible", () => {
  it("elegible (misma campaña, ACTIVE, onCover) → no lanza", () => {
    expect(code(() => assertPrincipalEligible(base, 1))).toBe("NO_THROW");
  });

  it("oferta de otra campaña → OFFER_NOT_FOUND", () => {
    expect(code(() => assertPrincipalEligible({ ...base, campaignId: 2 }, 1))).toBe(RETAIL_ERROR.OFFER_NOT_FOUND);
  });

  it.each(["HIDDEN", "CANCELLED"] as const)("oferta %s → OFFER_NOT_AVAILABLE", (status) => {
    expect(code(() => assertPrincipalEligible({ ...base, status }, 1))).toBe(RETAIL_ERROR.OFFER_NOT_AVAILABLE);
  });

  it("oferta fuera de portada → PRINCIPAL_NOT_ON_COVER", () => {
    expect(code(() => assertPrincipalEligible({ ...base, onCover: false }, 1))).toBe(RETAIL_ERROR.PRINCIPAL_NOT_ON_COVER);
  });

  it("chequea pertenencia ANTES que estado/portada (otra campaña + no activa → OFFER_NOT_FOUND)", () => {
    expect(code(() => assertPrincipalEligible({ campaignId: 2, status: "CANCELLED", onCover: false }, 1))).toBe(RETAIL_ERROR.OFFER_NOT_FOUND);
  });
});
