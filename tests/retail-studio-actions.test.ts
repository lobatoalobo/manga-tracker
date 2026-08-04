/**
 * Unit — server actions del Estudio (P-03). Adaptadores delgados sesión→servicio. Con mocks de auth, flag y
 * servicios: NO tocan DB. NO se mockea next/cache porque las actions del Estudio no usan revalidatePath.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addOfferAction, removeOfferAction, updateOfferPriceAction, reorderOffersAction,
  setOnCoverAction, setPrincipalAction, hideOfferAction, showOfferAction, cancelOfferAction, publishAction,
} from "@/app/tiendas/[slug]/admin/preventas/[campaignId]/estudio/actions";
import { requireUserId } from "@/auth";
import { isEnabled } from "@/lib/featureFlags";
import {
  addPreorderOffer, updatePreorderOffer, reorderPreorderOffers, setOfferOnCover,
  hidePreorderOffer, showPreorderOffer, cancelPreorderOffer, removeDraftPreorderOffer,
} from "@/lib/retail/offers";
import { setCampaignPrincipal, publishPreorderCampaign } from "@/lib/retail/campaigns";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { StoreAuthError, STORE_AUTH_ERROR } from "@/lib/domain/store/authorize";
import { retailErrorLabel } from "@/lib/retail/format";

vi.mock("@/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/lib/retail/offers", () => ({
  addPreorderOffer: vi.fn(), updatePreorderOffer: vi.fn(), reorderPreorderOffers: vi.fn(), setOfferOnCover: vi.fn(),
  hidePreorderOffer: vi.fn(), showPreorderOffer: vi.fn(), cancelPreorderOffer: vi.fn(), removeDraftPreorderOffer: vi.fn(),
}));
vi.mock("@/lib/retail/campaigns", () => ({ setCampaignPrincipal: vi.fn(), publishPreorderCampaign: vi.fn() }));

const USER = "user-1";
const offerRow = (over = {}) => ({
  id: 7, titleSnapshot: "Chainsaw Man", volumeNumberSnapshot: 1, publisherSnapshot: "Ivrea",
  listPriceCents: 10_000, preorderPriceCents: 8_000, status: "ACTIVE", onCover: false, sortOrder: 3, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue(USER);
});

describe("studio actions · actor + delegación", () => {
  it("resuelve el actor y delega en el servicio con los args exactos", async () => {
    vi.mocked(setOfferOnCover).mockResolvedValue({ offer: { id: 5, status: "ACTIVE", onCover: true }, principalOfferId: null });
    const r = await setOnCoverAction(5, true);
    expect(requireUserId).toHaveBeenCalledOnce();
    expect(setOfferOnCover).toHaveBeenCalledWith(5, true, USER);
    expect(r).toEqual({ ok: true, data: { offerId: 5, onCover: true, principalOfferId: null } });
  });

  it("sin sesión: requireUserId lanza → la action PROPAGA (no lo captura como dominio)", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Error("No autenticado"));
    await expect(setPrincipalAction(1, 2)).rejects.toThrow("No autenticado");
  });
});

describe("studio actions · mapeo de errores (uniforme)", () => {
  it("RetailError → { ok:false, code, message: retailErrorLabel(code) }", async () => {
    vi.mocked(updatePreorderOffer).mockRejectedValue(new RetailError(RETAIL_ERROR.INVALID_PRICE));
    const r = await updateOfferPriceAction(7, 5_000, 9_000);
    expect(r).toEqual({ ok: false, code: RETAIL_ERROR.INVALID_PRICE, message: retailErrorLabel(RETAIL_ERROR.INVALID_PRICE) });
  });

  it("StoreAuthError → mismo shape con su code", async () => {
    vi.mocked(setCampaignPrincipal).mockRejectedValue(new StoreAuthError(STORE_AUTH_ERROR.FORBIDDEN_ROLE));
    const r = await setPrincipalAction(1, 2);
    expect(r).toEqual({ ok: false, code: STORE_AUTH_ERROR.FORBIDDEN_ROLE, message: retailErrorLabel(STORE_AUTH_ERROR.FORBIDDEN_ROLE) });
  });

  it("sin dominio duplicado: un error de estado del servicio se surface tal cual", async () => {
    vi.mocked(reorderPreorderOffers).mockRejectedValue(new RetailError(RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE));
    const r = await reorderOffersAction(3, [2, 1]);
    expect(r).toMatchObject({ ok: false, code: RETAIL_ERROR.CAMPAIGN_NOT_EDITABLE });
  });
});

describe("studio actions · resultados serializables + reconcile", () => {
  it("agregar oferta → StudioOfferRow (snapshots→display)", async () => {
    vi.mocked(addPreorderOffer).mockResolvedValue(offerRow() as never);
    const r = await addOfferAction(3, { mode: "linked", volumeId: 42, listPriceCents: 10_000, preorderPriceCents: 8_000 });
    expect(addPreorderOffer).toHaveBeenCalledWith({ campaignId: 3, mode: "linked", volumeId: 42, listPriceCents: 10_000, preorderPriceCents: 8_000 }, USER);
    expect(r).toEqual({ ok: true, data: { offerId: 7, displayTitle: "Chainsaw Man", displayVolume: 1, displayPublisher: "Ivrea", listPriceCents: 10_000, preorderPriceCents: 8_000, status: "ACTIVE", onCover: false, sortOrder: 3 } });
  });

  it("bajar de portada a la principal devuelve principalOfferId=null (reconcile)", async () => {
    vi.mocked(setOfferOnCover).mockResolvedValue({ offer: { id: 7, status: "ACTIVE", onCover: false }, principalOfferId: null });
    const r = await setOnCoverAction(7, false);
    expect(r).toEqual({ ok: true, data: { offerId: 7, onCover: false, principalOfferId: null } });
  });

  it("ocultar devuelve estado + principal autoritativo", async () => {
    vi.mocked(hidePreorderOffer).mockResolvedValue({ offer: { id: 7, status: "HIDDEN", onCover: true }, principalOfferId: null });
    const r = await hideOfferAction(7);
    expect(r).toEqual({ ok: true, data: { offerId: 7, status: "HIDDEN", principalOfferId: null } });
  });

  it("mostrar devuelve solo estado (no toca principal)", async () => {
    vi.mocked(showPreorderOffer).mockResolvedValue({ offer: { id: 7, status: "ACTIVE", onCover: true }, principalOfferId: 7 });
    const r = await showOfferAction(7);
    expect(r).toEqual({ ok: true, data: { offerId: 7, status: "ACTIVE" } });
  });

  it("cancelar devuelve estado + principal autoritativo", async () => {
    vi.mocked(cancelPreorderOffer).mockResolvedValue({ offer: { id: 7, status: "CANCELLED", onCover: true }, principalOfferId: null });
    const r = await cancelOfferAction(7);
    expect(r).toEqual({ ok: true, data: { offerId: 7, status: "CANCELLED", principalOfferId: null } });
  });

  it("elegir/limpiar principal devuelve principalOfferId", async () => {
    vi.mocked(setCampaignPrincipal).mockResolvedValue({ principalOfferId: null } as never);
    expect(await setPrincipalAction(3, null)).toEqual({ ok: true, data: { principalOfferId: null } });
    expect(setCampaignPrincipal).toHaveBeenCalledWith(3, null, USER);
  });

  it("reordenar hace eco del orden aplicado", async () => {
    vi.mocked(reorderPreorderOffers).mockResolvedValue(undefined as never);
    const r = await reorderOffersAction(3, [9, 8, 7]);
    expect(reorderPreorderOffers).toHaveBeenCalledWith(3, [9, 8, 7], USER);
    expect(r).toEqual({ ok: true, data: { orderedOfferIds: [9, 8, 7] } });
  });

  it("quitar devuelve { offerId }", async () => {
    vi.mocked(removeDraftPreorderOffer).mockResolvedValue(undefined as never);
    expect(await removeOfferAction(7)).toEqual({ ok: true, data: { offerId: 7 } });
  });

  it("publicar: publishedAt se serializa como ISO string (JSON round-trip estable)", async () => {
    vi.mocked(publishPreorderCampaign).mockResolvedValue({ status: "PUBLISHED", publishedAt: new Date("2026-08-04T10:00:00.000Z") } as never);
    const r = await publishAction(3);
    expect(r).toEqual({ ok: true, data: { status: "PUBLISHED", publishedAt: "2026-08-04T10:00:00.000Z" } });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // serializable
  });
});

describe("studio actions · gate de ofertas manuales", () => {
  it("manual con el flag APAGADO → FEATURE_DISABLED y NO llama al servicio", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    const r = await addOfferAction(3, { mode: "manual", descriptor: { title: "X", volumeNumber: null, publisher: null, isbn: null }, listPriceCents: 100, preorderPriceCents: 80 });
    expect(r).toEqual({ ok: false, code: RETAIL_ERROR.FEATURE_DISABLED, message: retailErrorLabel(RETAIL_ERROR.FEATURE_DISABLED) });
    expect(addPreorderOffer).not.toHaveBeenCalled();
  });

  it("linked NO consulta el flag", async () => {
    vi.mocked(addPreorderOffer).mockResolvedValue(offerRow() as never);
    await addOfferAction(3, { mode: "linked", volumeId: 1, listPriceCents: 100, preorderPriceCents: 80 });
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
