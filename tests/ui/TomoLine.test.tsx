import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TomoLine } from "@/components/retail/ui/TomoLine";
import { Button } from "@/components/retail/ui/Button";

describe("TomoLine", () => {
  it("renderiza la identidad (serie + volumen)", () => {
    const { container } = render(<TomoLine tomo={{ serie: "Chainsaw Man", volumen: 17 }} />);
    const title = container.querySelector("[data-retail-tomoline-title]")!;
    expect(title).toHaveTextContent("Chainsaw Man");
    expect(title).toHaveTextContent("17");
  });

  it("compone un Cover decorativo (aria-hidden, sin duplicar el nombre)", () => {
    const { container } = render(<TomoLine tomo={{ serie: "Berserk", volumen: 41 }} />);
    const cover = container.querySelector("[data-retail-cover]")!;
    expect(cover).toBeInTheDocument();
    // La tapa va envuelta en un contenedor aria-hidden.
    expect(cover.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("muestra el precio mediante Money cuando corresponde", () => {
    const { container } = render(<TomoLine tomo={{ serie: "Akira", volumen: 1 }} precioCents={320000} />);
    const money = container.querySelector("[data-retail-money]")!;
    expect(money).toHaveTextContent("$3.200");
  });

  it("la metadata secundaria (autor) es opcional", () => {
    const { rerender } = render(<TomoLine tomo={{ serie: "Vinland Saga", volumen: 12, autor: "Makoto Yukimura" }} />);
    expect(screen.getByText("Makoto Yukimura")).toBeInTheDocument();
    rerender(<TomoLine tomo={{ serie: "Vinland Saga", volumen: 12 }} />);
    expect(screen.queryByText("Makoto Yukimura")).toBeNull();
  });

  it("expone el slot de acción y es interactivo (la fila no lo es)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <TomoLine tomo={{ serie: "Dandadan", volumen: 5 }} accion={<Button size="small" onClick={onClick}>Apartar</Button>} />,
    );
    const btn = screen.getByRole("button", { name: "Apartar" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    // La fila en sí no es un botón.
    expect(container.querySelector("[data-retail-tomoline]")!.tagName).toBe("DIV");
  });

  it("sin campos opcionales: solo identidad, sin Money ni acción", () => {
    const { container } = render(<TomoLine tomo={{ serie: "Blame!", volumen: 1 }} />);
    expect(container.querySelector("[data-retail-money]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("estado sin-precio: data-estado + alternativa textual 'Sin precio'", () => {
    const { container } = render(<TomoLine tomo={{ serie: "Gantz", volumen: 3 }} estadoVisual="sin-precio" />);
    const row = container.querySelector("[data-retail-tomoline]")!;
    expect(row).toHaveAttribute("data-estado", "sin-precio");
    expect(within(row as HTMLElement).getByText("Sin precio")).toBeInTheDocument();
  });

  it("estados visuales faltante/atenuada se exponen como data-estado", () => {
    const { container } = render(<TomoLine tomo={{ serie: "Gantz", volumen: 3 }} estadoVisual="faltante" />);
    expect(container.querySelector("[data-retail-tomoline]")).toHaveAttribute("data-estado", "faltante");
    const { container: c2 } = render(<TomoLine tomo={{ serie: "Gantz", volumen: 4 }} estadoVisual="atenuada" />);
    expect(c2.querySelector("[data-retail-tomoline]")).toHaveAttribute("data-estado", "atenuada");
  });

  it("título largo: el nodo de título trunca con elipsis", () => {
    const largo = "Kaguya-sama: Love Is War — Ultra Romantic Edición Especial Aniversario";
    const { container } = render(<TomoLine tomo={{ serie: largo }} />);
    const title = container.querySelector("[data-retail-tomoline-title]") as HTMLElement;
    expect(title).toHaveTextContent(largo);
    expect(title.style.textOverflow).toBe("ellipsis");
    expect(title.style.whiteSpace).toBe("nowrap");
  });
});
