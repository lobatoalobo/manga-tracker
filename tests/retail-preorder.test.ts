import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_STATUS, canTransitionCampaign, assertCampaignTransition, isDraftEditable, assertDraftEditable,
  assertValidTitle, assertValidDates, assertPublishable, isCampaignOpen, publicAvailabilityLabel,
} from "@/lib/domain/retail/campaign";
import { OFFER_STATUS, canTransitionOffer, assertValidPrices, derivedDiscountPercent, assertValidManualDescriptor } from "@/lib/domain/retail/offer";
import { CAMPAIGN_POLICY, CAMPAIGN_ACTION, policyFor } from "@/lib/domain/retail/policy";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { STORE_ROLE } from "@/lib/domain/store/authorize";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};

// ---------------------------------------------------------------------------
// Máquina de estados de campaña
// ---------------------------------------------------------------------------
describe("campaign state machine", () => {
  it("permite DRAFT→PUBLISHED, DRAFT→CANCELLED, PUBLISHED→CLOSED, PUBLISHED→CANCELLED", () => {
    expect(canTransitionCampaign("DRAFT", "PUBLISHED")).toBe(true);
    expect(canTransitionCampaign("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionCampaign("PUBLISHED", "CLOSED")).toBe(true);
    expect(canTransitionCampaign("PUBLISHED", "CANCELLED")).toBe(true);
  });
  it("prohíbe reabrir y saltos ilegales", () => {
    expect(canTransitionCampaign("CLOSED", "PUBLISHED")).toBe(false);
    expect(canTransitionCampaign("CANCELLED", "PUBLISHED")).toBe(false);
    expect(canTransitionCampaign("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransitionCampaign("DRAFT", "CLOSED")).toBe(false);
    expect(code(() => assertCampaignTransition("CLOSED", "PUBLISHED"))).toBe(RETAIL_ERROR.INVALID_CAMPAIGN_TRANSITION);
  });
  it("solo DRAFT es editable libremente", () => {
    expect(isDraftEditable("DRAFT")).toBe(true);
    expect(isDraftEditable("PUBLISHED")).toBe(false);
    expect(code(() => assertDraftEditable("PUBLISHED"))).toBe(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE);
  });
});

// ---------------------------------------------------------------------------
// Disponibilidad temporal (now inyectado)
// ---------------------------------------------------------------------------
describe("temporal availability (isCampaignOpen)", () => {
  const base = { status: CAMPAIGN_STATUS.PUBLISHED, opensAt: null, closesAt: null, storeEnabled: true };
  const now = new Date("2026-07-25T12:00:00Z");
  it("PUBLISHED + habilitada + sin ventana → abierta", () => {
    expect(isCampaignOpen(base, now)).toBe(true);
  });
  it("no abierta si no está PUBLISHED o la tienda está deshabilitada", () => {
    expect(isCampaignOpen({ ...base, status: CAMPAIGN_STATUS.DRAFT }, now)).toBe(false);
    expect(isCampaignOpen({ ...base, storeEnabled: false }, now)).toBe(false);
  });
  it("respeta opensAt (futuro) y closesAt (pasado)", () => {
    expect(isCampaignOpen({ ...base, opensAt: new Date("2026-07-26T00:00:00Z") }, now)).toBe(false); // aún no abre
    expect(isCampaignOpen({ ...base, closesAt: new Date("2026-07-24T00:00:00Z") }, now)).toBe(false); // ya cerró
    expect(isCampaignOpen({ ...base, opensAt: new Date("2026-07-01T00:00:00Z"), closesAt: new Date("2026-08-01T00:00:00Z") }, now)).toBe(true);
  });
  it("etiqueta pública derivada", () => {
    expect(publicAvailabilityLabel(base, now)).toBe("OPEN");
    expect(publicAvailabilityLabel({ ...base, status: CAMPAIGN_STATUS.CLOSED }, now)).toBe("CLOSED");
    expect(publicAvailabilityLabel({ ...base, opensAt: new Date("2026-07-26T00:00:00Z") }, now)).toBe("NOT_YET");
    expect(publicAvailabilityLabel({ ...base, closesAt: new Date("2026-07-24T00:00:00Z") }, now)).toBe("ENDED");
  });
});

// ---------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------
describe("validations", () => {
  it("título no vacío", () => {
    expect(assertValidTitle("  Preventa  ")).toBe("Preventa");
    expect(code(() => assertValidTitle("   "))).toBe(RETAIL_ERROR.INVALID_TITLE);
  });
  it("fechas coherentes (opens < closes)", () => {
    expect(code(() => assertValidDates(new Date("2026-07-02"), new Date("2026-07-01")))).toBe(RETAIL_ERROR.INVALID_DATES);
    expect(code(() => assertValidDates(new Date("2026-07-01"), new Date("2026-07-02")))).toBe("NO_THROW");
    expect(code(() => assertValidDates(null, null))).toBe("NO_THROW");
  });
  it("precios: enteros ≥0 y preventa ≤ lista", () => {
    expect(code(() => assertValidPrices(1000, 800))).toBe("NO_THROW");
    expect(code(() => assertValidPrices(1000, 1200))).toBe(RETAIL_ERROR.INVALID_PRICE); // preventa > lista
    expect(code(() => assertValidPrices(-1, 0))).toBe(RETAIL_ERROR.INVALID_PRICE);
    expect(code(() => assertValidPrices(1000.5, 800))).toBe(RETAIL_ERROR.INVALID_PRICE); // no entero
  });
  it("descuento derivado", () => {
    expect(derivedDiscountPercent(1000, 700)).toBe(30);
    expect(derivedDiscountPercent(1000, 1000)).toBe(0);
    expect(derivedDiscountPercent(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Precondiciones de publicación
// ---------------------------------------------------------------------------
describe("assertPublishable", () => {
  const ok = { title: "P", opensAt: null, closesAt: null, storeEnabled: true, activeOfferCount: 1 };
  it("válida no lanza", () => expect(code(() => assertPublishable(ok))).toBe("NO_THROW"));
  it("sin ofertas activas → CAMPAIGN_HAS_NO_OFFERS", () => expect(code(() => assertPublishable({ ...ok, activeOfferCount: 0 }))).toBe(RETAIL_ERROR.CAMPAIGN_HAS_NO_OFFERS));
  it("tienda deshabilitada → STORE_COMMERCE_DISABLED", () => expect(code(() => assertPublishable({ ...ok, storeEnabled: false }))).toBe(RETAIL_ERROR.STORE_COMMERCE_DISABLED));
  it("título vacío → INVALID_TITLE", () => expect(code(() => assertPublishable({ ...ok, title: " " }))).toBe(RETAIL_ERROR.INVALID_TITLE));
  it("fechas incoherentes → INVALID_DATES", () => expect(code(() => assertPublishable({ ...ok, opensAt: new Date("2026-07-02"), closesAt: new Date("2026-07-01") }))).toBe(RETAIL_ERROR.INVALID_DATES));
});

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------
describe("offer state machine", () => {
  it("ACTIVE↔HIDDEN, ACTIVE/HIDDEN→CANCELLED; CANCELLED terminal", () => {
    expect(canTransitionOffer("ACTIVE", "HIDDEN")).toBe(true);
    expect(canTransitionOffer("HIDDEN", "ACTIVE")).toBe(true);
    expect(canTransitionOffer("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransitionOffer("HIDDEN", "CANCELLED")).toBe(true);
    expect(canTransitionOffer("CANCELLED", "ACTIVE")).toBe(false);
  });
  it("OFFER_STATUS por default ACTIVE", () => expect(OFFER_STATUS.ACTIVE).toBe("ACTIVE"));
});

// ---------------------------------------------------------------------------
// Política de roles (central)
// ---------------------------------------------------------------------------
describe("role policy matrix", () => {
  it("publicar y cancelar: solo OWNER; requireEnabled en publicar", () => {
    expect(CAMPAIGN_POLICY.PUBLISH.roles).toEqual([STORE_ROLE.OWNER]);
    expect(CAMPAIGN_POLICY.PUBLISH.requireEnabled).toBe(true);
    expect(CAMPAIGN_POLICY.CANCEL.roles).toEqual([STORE_ROLE.OWNER]);
  });
  it("preparación (crear/editar/ofertas) y cerrar: OWNER y STAFF", () => {
    for (const a of [CAMPAIGN_ACTION.CREATE, CAMPAIGN_ACTION.EDIT_DRAFT, CAMPAIGN_ACTION.MANAGE_OFFERS, CAMPAIGN_ACTION.CLOSE]) {
      expect(policyFor(a).roles).toEqual([STORE_ROLE.OWNER, STORE_ROLE.STAFF]);
    }
  });
  it("eliminar borrador: solo OWNER; cerrar/cancelar no exigen habilitada", () => {
    expect(CAMPAIGN_POLICY.DELETE_DRAFT.roles).toEqual([STORE_ROLE.OWNER]);
    expect(CAMPAIGN_POLICY.CLOSE.requireEnabled).toBe(false);
    expect(CAMPAIGN_POLICY.CANCEL.requireEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Descriptor de oferta MANUAL (slice vínculo de catálogo opcional)
// ---------------------------------------------------------------------------
describe("assertValidManualDescriptor", () => {
  it("acepta un descriptor mínimo válido y normaliza (trim, vacío→null)", () => {
    const d = assertValidManualDescriptor({ title: "  Kagurabachi  ", volumeNumber: 1, publisher: " Ivrea ", isbn: "" });
    expect(d).toEqual({ title: "Kagurabachi", volumeNumber: 1, publisher: "Ivrea", isbn: null });
  });
  it("permite número/editorial/isbn ausentes (lanzamiento sin ficha)", () => {
    const d = assertValidManualDescriptor({ title: "Serie debut" });
    expect(d).toEqual({ title: "Serie debut", volumeNumber: null, publisher: null, isbn: null });
  });
  it("rechaza título vacío o solo espacios → INVALID_TITLE", () => {
    expect(code(() => assertValidManualDescriptor({ title: "" }))).toBe(RETAIL_ERROR.INVALID_TITLE);
    expect(code(() => assertValidManualDescriptor({ title: "   " }))).toBe(RETAIL_ERROR.INVALID_TITLE);
  });
  it("rechaza título demasiado largo → INVALID_TITLE", () => {
    expect(code(() => assertValidManualDescriptor({ title: "x".repeat(301) }))).toBe(RETAIL_ERROR.INVALID_TITLE);
    expect(code(() => assertValidManualDescriptor({ title: "x".repeat(300) }))).toBe("NO_THROW");
  });
  it("rechaza número de tomo no entero o negativo → INVALID_OFFER_DESCRIPTOR", () => {
    expect(code(() => assertValidManualDescriptor({ title: "T", volumeNumber: -1 }))).toBe(RETAIL_ERROR.INVALID_OFFER_DESCRIPTOR);
    expect(code(() => assertValidManualDescriptor({ title: "T", volumeNumber: 1.5 }))).toBe(RETAIL_ERROR.INVALID_OFFER_DESCRIPTOR);
    expect(code(() => assertValidManualDescriptor({ title: "T", volumeNumber: 0 }))).toBe("NO_THROW"); // 0 válido
  });
});
