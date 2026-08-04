import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import EstudioClient from "@/app/tiendas/[slug]/admin/preventas/[campaignId]/estudio/EstudioClient";
import type { StudioOfferRow } from "@/lib/retail/studio";
import * as A from "@/app/tiendas/[slug]/admin/preventas/[campaignId]/estudio/actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/tiendas/[slug]/admin/preventas/[campaignId]/estudio/actions", () => ({
  addOfferAction: vi.fn(), removeOfferAction: vi.fn(), updateOfferPriceAction: vi.fn(), reorderOffersAction: vi.fn(),
  setOnCoverAction: vi.fn(), setPrincipalAction: vi.fn(), hideOfferAction: vi.fn(), showOfferAction: vi.fn(),
  cancelOfferAction: vi.fn(), publishAction: vi.fn(),
}));
vi.mock("@/app/tiendas/[slug]/admin/preventas/actions", () => ({ searchVolumesAction: vi.fn() }));

const rows = (): StudioOfferRow[] => [
  { offerId: 1, displayTitle: "Chainsaw Man", displayVolume: 1, displayPublisher: "Ivrea", listPriceCents: 10_000, preorderPriceCents: 8_000, status: "ACTIVE", onCover: false, sortOrder: 0 },
  { offerId: 2, displayTitle: "Spy x Family", displayVolume: 2, displayPublisher: "Ivrea", listPriceCents: 12_000, preorderPriceCents: 9_000, status: "ACTIVE", onCover: true, sortOrder: 1 },
];
const draft = (over: Partial<React.ComponentProps<typeof EstudioClient>> = {}) =>
  render(<EstudioClient campaignId={3} status="DRAFT" titulo="Edición X" weekLabel="12/08" principalOfferId={null} rows={rows()} {...over} />);
const rowEl = (id: number) => document.querySelector(`[data-offer-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(A.setOnCoverAction).mockResolvedValue({ ok: true, data: { offerId: 1, onCover: true, principalOfferId: null } });
  vi.mocked(A.setPrincipalAction).mockResolvedValue({ ok: true, data: { principalOfferId: 2 } });
  vi.mocked(A.reorderOffersAction).mockResolvedValue({ ok: true, data: { orderedOfferIds: [2, 1] } });
  vi.mocked(A.updateOfferPriceAction).mockResolvedValue({ ok: true, data: { offerId: 1, listPriceCents: 11_000, preorderPriceCents: 9_500 } });
  vi.mocked(A.hideOfferAction).mockResolvedValue({ ok: true, data: { offerId: 1, status: "HIDDEN", principalOfferId: null } });
  vi.mocked(A.publishAction).mockResolvedValue({ ok: true, data: { status: "PUBLISHED", publishedAt: "2026-08-04T10:00:00.000Z" } });
});

describe("EstudioClient · render inicial + composición", () => {
  it("muestra la lista real y el título de la edición", () => {
    draft();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Edición X");
    // El título aparece en el greybox del Cover y en el título de la fila → varias apariciones.
    expect(screen.getAllByText("Chainsaw Man").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Spy x Family").length).toBeGreaterThan(0);
  });

  it("solo la fase Estudio/Creación en la nav (sin fases futuras)", () => {
    draft();
    const nav = screen.getByRole("navigation", { name: "Fases de la edición" });
    expect(within(nav).getByRole("button", { name: "Creación" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Preventa" })).toBeNull();
  });

  it("ítem en portada muestra el Pill 'En portada'", () => {
    draft();
    expect(within(rowEl(2)).getByText("En portada")).toBeInTheDocument();
  });
});

describe("EstudioClient · gestos optimistas + reconcile", () => {
  it("llevar a portada refleja el estado y delega en la action", async () => {
    draft();
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Llevar a portada" }));
    expect(A.setOnCoverAction).toHaveBeenCalledWith(1, true);
    await waitFor(() => expect(within(rowEl(1)).getByText("En portada")).toBeInTheDocument());
  });

  it("rollback: si la action falla, restaura el estado y muestra el error de fila", async () => {
    vi.mocked(A.setOnCoverAction).mockResolvedValue({ ok: false, code: "OFFER_NOT_EDITABLE", message: "No editable" } as never);
    draft();
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Llevar a portada" }));
    await waitFor(() => expect(within(rowEl(1)).getByRole("alert")).toHaveTextContent("No editable"));
    expect(within(rowEl(1)).queryByText("En portada")).toBeNull(); // revertido
  });

  it("hacer principal → Pill 'Principal'", async () => {
    draft();
    fireEvent.click(within(rowEl(2)).getByRole("button", { name: "Hacer principal" }));
    expect(A.setPrincipalAction).toHaveBeenCalledWith(3, 2);
    await waitFor(() => expect(within(rowEl(2)).getByText("Principal")).toBeInTheDocument());
  });

  it("reorden: 'Bajar' en la primera fila reordena con el conjunto completo", () => {
    draft();
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Bajar" }));
    expect(A.reorderOffersAction).toHaveBeenCalledWith(3, [2, 1]);
  });
});

describe("EstudioClient · precio inline", () => {
  it("Guardar persiste ambos precios en centavos", () => {
    draft();
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Editar precio" }));
    fireEvent.change(within(rowEl(1)).getByLabelText("Precio de lista"), { target: { value: "110" } });
    fireEvent.change(within(rowEl(1)).getByLabelText("Precio de preventa"), { target: { value: "95" } });
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Guardar" }));
    expect(A.updateOfferPriceAction).toHaveBeenCalledWith(1, 11_000, 9_500);
  });

  it("Escape cancela y no persiste", () => {
    draft();
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Editar precio" }));
    const group = within(rowEl(1)).getByRole("group", { name: "Editar precio" });
    fireEvent.keyDown(group, { key: "Escape" });
    expect(within(rowEl(1)).queryByRole("group", { name: "Editar precio" })).toBeNull();
    expect(A.updateOfferPriceAction).not.toHaveBeenCalled();
  });
});

describe("EstudioClient · refresh + publicar", () => {
  it("ocultar dispara router.refresh()", async () => {
    draft();
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Ocultar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("publicar con ≥1 activa llama publishAction y refresca", async () => {
    draft();
    fireEvent.click(screen.getByRole("button", { name: "Publicar edición" }));
    expect(A.publishAction).toHaveBeenCalledWith(3);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sin tomos: publicar deshabilitado + hint de bloqueo (server sigue siendo autoridad)", () => {
    draft({ rows: [] });
    expect(screen.getByRole("button", { name: "Publicar edición" })).toBeDisabled();
    expect(screen.getByText("Agregá al menos un tomo para publicar.")).toBeInTheDocument();
  });
});

describe("EstudioClient · modo lectura tras publicar", () => {
  it("status PUBLISHED → sin controles de edición, con aviso de solo lectura", () => {
    draft({ status: "PUBLISHED" });
    expect(screen.getByRole("status")).toHaveTextContent("solo lectura");
    expect(within(rowEl(1)).queryByRole("button", { name: "Editar precio" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publicar edición" })).toBeNull();
  });
});
