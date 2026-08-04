/**
 * Unit — server action addOfferAction (slice F4). Verifica la re-validación SERVER-SIDE del flag
 * `retail-manual-offers` (bypass de UI rechazado con el flag apagado), la conversión del form a la entrada
 * discriminada explícita (linked|manual, nunca ambigua) y la diferenciación de errores. Con mocks de auth,
 * flag, servicio y revalidatePath: NO toca DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { addOfferAction } from "@/app/tiendas/[slug]/admin/preventas/actions";
import { isEnabled } from "@/lib/featureFlags";
import { requireUserId } from "@/auth";
import { addPreorderOffer } from "@/lib/retail/offers";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/retail/offers", () => ({
  addPreorderOffer: vi.fn(),
  updatePreorderOffer: vi.fn(), hidePreorderOffer: vi.fn(), showPreorderOffer: vi.fn(),
  cancelPreorderOffer: vi.fn(), removeDraftPreorderOffer: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USER = "user-1";
const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue(USER);
  vi.mocked(addPreorderOffer).mockResolvedValue({} as never);
});

describe("addOfferAction — flag retail-manual-offers (write path)", () => {
  it("BYPASS de UI: mode=manual con el flag APAGADO → FEATURE_DISABLED y NO crea", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    const r = await addOfferAction("crumb", 10, fd({ mode: "manual", title: "X", listPrice: "100", preorderPrice: "80" }));
    expect(r).toEqual({ ok: false, error: "FEATURE_DISABLED" });
    expect(addPreorderOffer).not.toHaveBeenCalled();
  });

  it("mode=manual con el flag ENCENDIDO → entrada { mode:'manual', descriptor } explícita", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    const r = await addOfferAction("crumb", 10, fd({ mode: "manual", title: "  Kagurabachi ", volumeNumber: "1", publisher: "Ivrea", isbn: "", listPrice: "100", preorderPrice: "80" }));
    expect(r).toEqual({ ok: true });
    expect(addPreorderOffer).toHaveBeenCalledTimes(1);
    expect(addPreorderOffer).toHaveBeenCalledWith(
      { campaignId: 10, mode: "manual", descriptor: { title: "Kagurabachi", volumeNumber: 1, publisher: "Ivrea", isbn: null }, listPriceCents: 10000, preorderPriceCents: 8000 },
      USER,
    );
  });

  it("número de tomo vacío → null en el descriptor (no 0)", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    await addOfferAction("crumb", 10, fd({ mode: "manual", title: "Debut", volumeNumber: "", listPrice: "100", preorderPrice: "100" }));
    expect(vi.mocked(addPreorderOffer).mock.calls[0][0]).toMatchObject({ mode: "manual", descriptor: { volumeNumber: null } });
  });

  it("mode=linked NO está gateado por el flag (flag apagado igual crea) → { mode:'linked', volumeId }", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    const r = await addOfferAction("crumb", 10, fd({ mode: "linked", volumeId: "42", listPrice: "100", preorderPrice: "80" }));
    expect(r).toEqual({ ok: true });
    expect(isEnabled).not.toHaveBeenCalled(); // linked no consulta el flag
    expect(addPreorderOffer).toHaveBeenCalledWith(
      { campaignId: 10, mode: "linked", volumeId: 42, listPriceCents: 10000, preorderPriceCents: 8000 },
      USER,
    );
  });

  it("sin mode (form legado) → default linked (compatibilidad hacia atrás)", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    await addOfferAction("crumb", 10, fd({ volumeId: "7", listPrice: "100", preorderPrice: "80" }));
    expect(vi.mocked(addPreorderOffer).mock.calls[0][0]).toMatchObject({ mode: "linked", volumeId: 7 });
  });

  it("errores diferenciados: el código de dominio se propaga tal cual (p. ej. INVALID_TITLE)", async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(addPreorderOffer).mockRejectedValue(new RetailError(RETAIL_ERROR.INVALID_TITLE));
    const r = await addOfferAction("crumb", 10, fd({ mode: "manual", title: "", listPrice: "100", preorderPrice: "80" }));
    expect(r).toEqual({ ok: false, error: "INVALID_TITLE" });
  });
});
