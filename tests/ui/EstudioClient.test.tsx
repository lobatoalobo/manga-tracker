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

// row1: One Piece (fuera de portada) · row2: Spy x Family (en portada, sin destacar)
const rows = (): StudioOfferRow[] => [
  { offerId: 1, displayTitle: "One Piece", displayVolume: 1, displayPublisher: "Ivrea", listPriceCents: 10_000, preorderPriceCents: 8_000, status: "ACTIVE", onCover: false, sortOrder: 0 },
  { offerId: 2, displayTitle: "Spy x Family", displayVolume: 2, displayPublisher: "Ivrea", listPriceCents: 12_000, preorderPriceCents: 9_000, status: "ACTIVE", onCover: true, sortOrder: 1 },
];
const draft = (over: Partial<React.ComponentProps<typeof EstudioClient>> = {}) =>
  render(<EstudioClient campaignId={3} status="DRAFT" titulo="Edición X" weekLabel="12/08" principalOfferId={null} rows={rows()} {...over} />);
const rowEl = (id: number) => document.querySelector(`[data-offer-id="${id}"]`) as HTMLElement;
const foco = (id: number, name: string) => fireEvent.click(within(rowEl(id)).getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(A.setOnCoverAction).mockResolvedValue({ ok: true, data: { offerId: 1, onCover: true, principalOfferId: null } });
  vi.mocked(A.setPrincipalAction).mockResolvedValue({ ok: true, data: { principalOfferId: 2 } });
  vi.mocked(A.reorderOffersAction).mockResolvedValue({ ok: true, data: { orderedOfferIds: [2, 1] } });
  vi.mocked(A.updateOfferPriceAction).mockResolvedValue({ ok: true, data: { offerId: 1, listPriceCents: 11_000, preorderPriceCents: 9_500 } });
  vi.mocked(A.hideOfferAction).mockResolvedValue({ ok: true, data: { offerId: 1, status: "HIDDEN", principalOfferId: null } });
  vi.mocked(A.publishAction).mockResolvedValue({ ok: true, data: { status: "PUBLISHED", publishedAt: "2026-08-04T10:00:00.000Z" } });
});

describe("EstudioClient · reposo silencioso + maqueta", () => {
  it("muestra la edición y el título, sin controles ni etiquetas técnicas en reposo", () => {
    draft();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Edición X");
    expect(screen.getAllByText("One Piece").length).toBeGreaterThan(0);
    // Sin vocabulario interno ni controles hasta enfocar.
    expect(screen.queryByText("En portada")).toBeNull();
    expect(screen.queryByText("Principal")).toBeNull();
    expect(screen.queryByRole("button", { name: "Agregar a portada" })).toBeNull();
  });

  it("solo la fase Creación en la nav", () => {
    draft();
    const nav = screen.getByRole("navigation", { name: "Fases de la edición" });
    expect(within(nav).getByRole("button", { name: "Creación" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Preventa" })).toBeNull();
  });

  it("maqueta: sin destacado pide elegirlo y titula 'Portada'", () => {
    draft();
    expect(screen.getByRole("heading", { name: "Portada" })).toBeInTheDocument();
    expect(screen.getByText("Elegí qué tomo destacar.")).toBeInTheDocument();
  });
});

describe("EstudioClient · foco revela controles + gestos", () => {
  it("enfocar un tomo revela su tira de controles", () => {
    draft();
    expect(within(rowEl(1)).queryByRole("button", { name: "Agregar a portada" })).toBeNull();
    foco(1, "One Piece 1");
    expect(within(rowEl(1)).getByRole("button", { name: "Agregar a portada" })).toBeInTheDocument();
  });

  it("'Agregar a portada' delega en la action", () => {
    draft();
    foco(1, "One Piece 1");
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Agregar a portada" }));
    expect(A.setOnCoverAction).toHaveBeenCalledWith(1, true);
  });

  it("rollback: si la action falla, restaura y muestra el error de fila", async () => {
    vi.mocked(A.setOnCoverAction).mockResolvedValue({ ok: false, code: "OFFER_NOT_EDITABLE", message: "No editable" } as never);
    draft();
    foco(1, "One Piece 1");
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Agregar a portada" }));
    await waitFor(() => expect(within(rowEl(1)).getByRole("alert")).toHaveTextContent("No editable"));
    // revertido: sigue "Agregar a portada" (no pasó a "Quitar de portada")
    expect(within(rowEl(1)).getByRole("button", { name: "Agregar a portada" })).toBeInTheDocument();
  });

  it("'Destacar' un tomo en portada delega en la action", () => {
    draft();
    foco(2, "Spy x Family 2");
    fireEvent.click(within(rowEl(2)).getByRole("button", { name: "Destacar" }));
    expect(A.setPrincipalAction).toHaveBeenCalledWith(3, 2);
  });

  it("'Atrasar' reordena con el conjunto completo", () => {
    draft();
    foco(1, "One Piece 1");
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Atrasar" }));
    expect(A.reorderOffersAction).toHaveBeenCalledWith(3, [2, 1]);
  });
});

describe("EstudioClient · ajustar precio", () => {
  it("Guardar persiste ambos precios en centavos", () => {
    draft();
    foco(1, "One Piece 1");
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Ajustar precio" }));
    fireEvent.change(within(rowEl(1)).getByLabelText("Precio de lista"), { target: { value: "110" } });
    fireEvent.change(within(rowEl(1)).getByLabelText("Precio de preventa"), { target: { value: "95" } });
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Guardar" }));
    expect(A.updateOfferPriceAction).toHaveBeenCalledWith(1, 11_000, 9_500);
  });

  it("Escape cancela y no persiste", () => {
    draft();
    foco(1, "One Piece 1");
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Ajustar precio" }));
    const group = within(rowEl(1)).getByRole("group", { name: "Ajustar precio" });
    fireEvent.keyDown(group, { key: "Escape" });
    expect(within(rowEl(1)).queryByRole("group", { name: "Ajustar precio" })).toBeNull();
    expect(A.updateOfferPriceAction).not.toHaveBeenCalled();
  });
});

describe("EstudioClient · más acciones + publicar", () => {
  it("'···' abre el sheet y 'Pausar' dispara la action + refresh", async () => {
    draft();
    foco(1, "One Piece 1");
    fireEvent.click(within(rowEl(1)).getByRole("button", { name: "Más acciones" }));
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    expect(A.hideOfferAction).toHaveBeenCalledWith(1);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("publicar con ≥1 activa llama publishAction y refresca", async () => {
    draft();
    fireEvent.click(screen.getByRole("button", { name: "Publicar edición" }));
    expect(A.publishAction).toHaveBeenCalledWith(3);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sin tomos: publicar deshabilitado + bloqueo real + maqueta pide armar la edición", () => {
    draft({ rows: [] });
    expect(screen.getByRole("button", { name: "Publicar edición" })).toBeDisabled();
    expect(screen.getByText("Agregá un tomo para publicar la edición.")).toBeInTheDocument();
    expect(screen.getByText("Agregá tomos para armar la edición.")).toBeInTheDocument();
  });
});

describe("EstudioClient · modo lectura tras publicar", () => {
  it("status PUBLISHED → sin controles ni foco, con aviso de solo lectura", () => {
    draft({ status: "PUBLISHED" });
    expect(screen.getByRole("status")).toHaveTextContent("solo lectura");
    expect(within(rowEl(1)).queryByRole("button", { name: "One Piece 1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publicar edición" })).toBeNull();
  });
});
