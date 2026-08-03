import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionBar } from "@/components/retail/ui/ActionBar";
import { Button } from "@/components/retail/ui/Button";

describe("ActionBar", () => {
  it("renderiza el resumen y las acciones por slot", () => {
    const { container } = render(
      <ActionBar resumen="3 tomos · $9.600" acciones={<Button>Publicar</Button>} />,
    );
    expect(screen.getByText("3 tomos · $9.600")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar" })).toBeInTheDocument();
    expect(container.querySelector("[data-retail-actionbar]")).not.toHaveAttribute("data-bloqueada");
  });

  it("bloqueo: muestra el motivo en role=status y marca data-bloqueada", () => {
    const { container } = render(<ActionBar bloqueo="Faltan 2 precios" acciones={<Button disabled>Publicar</Button>} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Faltan 2 precios");
    expect(container.querySelector("[data-retail-actionbar]")).toHaveAttribute("data-bloqueada");
  });

  it("loading: expone aria-busy", () => {
    const { container } = render(<ActionBar loading resumen="Publicando…" />);
    expect(container.querySelector("[data-retail-actionbar]")).toHaveAttribute("aria-busy", "true");
  });

  it("las acciones son interactivas (dispara el onClick del Button)", () => {
    const onClick = vi.fn();
    render(<ActionBar acciones={<Button onClick={onClick}>Cerrar preventa</Button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar preventa" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("sticky: aplica position sticky solo cuando se pide", () => {
    const { container, rerender } = render(<ActionBar resumen="x" />);
    expect((container.querySelector("[data-retail-actionbar]") as HTMLElement).style.position).toBe("");
    rerender(<ActionBar resumen="x" sticky />);
    expect((container.querySelector("[data-retail-actionbar]") as HTMLElement).style.position).toBe("sticky");
  });

  it("no calcula el bloqueo: solo muestra lo que recibe", () => {
    const { container } = render(<ActionBar acciones={<Button>Entregar</Button>} />);
    // Sin `bloqueo` no hay estado bloqueado inventado.
    expect(container.querySelector("[data-retail-actionbar]")).not.toHaveAttribute("data-bloqueada");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
