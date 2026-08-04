import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Portada, type PortadaItem } from "@/components/retail/ui/Portada";
import { Button } from "@/components/retail/ui/Button";

const item = (serie: string, extra: Partial<PortadaItem> = {}): PortadaItem => ({ tomo: { serie }, ...extra });

describe("Portada", () => {
  it("renderiza la principal y las secundarias", () => {
    const { container } = render(
      <Portada principal={item("Berserk")} secundarias={[item("Gantz"), item("Blame!")]} />,
    );
    expect(container.querySelector('[data-rol="principal"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-rol="secundaria"]')).toHaveLength(2);
    expect(container.querySelectorAll("[data-retail-cover]")).toHaveLength(3);
  });

  it("respeta el orden recibido de secundarias (no sortea)", () => {
    const { container } = render(
      <Portada principal={item("Akira")} secundarias={[item("Zeta"), item("Alfa"), item("Mu")]} />,
    );
    const titles = Array.from(container.querySelectorAll('[data-rol="secundaria"] [data-retail-cover]')).map(
      (c) => c.textContent,
    );
    expect(titles).toEqual(["Zeta", "Alfa", "Mu"]);
  });

  it("no elige la principal: renderiza la que se le pasa", () => {
    const { container } = render(<Portada principal={item("Elegida")} secundarias={[item("Otra")]} />);
    const principal = container.querySelector('[data-rol="principal"] [data-retail-cover]')!;
    expect(principal).toHaveTextContent("Elegida");
  });

  it("vacía sin `vacio`: no renderiza nada (lista pura, D-006)", () => {
    const { container } = render(<Portada />);
    expect(container.querySelector("[data-retail-portada]")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("vacía con `vacio`: renderiza el contenido provisto", () => {
    const { container } = render(<Portada vacio={<p>Sin portada — llevá un tomo</p>} />);
    expect(container.querySelector("[data-retail-portada]")).toHaveAttribute("data-vacia");
    expect(screen.getByText("Sin portada — llevá un tomo")).toBeInTheDocument();
  });

  it("acciones entran por slot (accion) y son interactivas", () => {
    const onClick = vi.fn();
    render(
      <Portada
        tamano="mini"
        principal={item("Berserk", { accion: <Button size="small" onClick={onClick}>Bajar</Button> })}
      />,
    );
    const btn = screen.getByRole("button", { name: "Bajar" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("grande: tapa decorativa (aria-hidden) y título textual visible", () => {
    const { container } = render(<Portada principal={item("Vinland Saga", { tomo: { serie: "Vinland Saga", volumen: 12, autor: "Makoto Yukimura" }, precioCents: 320000 })} tamano="grande" />);
    const cover = container.querySelector('[data-rol="principal"] [data-retail-cover]')!;
    expect(cover.closest('[aria-hidden="true"]')).not.toBeNull();
    // El título y el precio acompañan a la tapa en grande.
    const block = container.querySelector('[data-rol="principal"]') as HTMLElement;
    expect(within(block).getByText("Makoto Yukimura")).toBeInTheDocument();
    expect(block.querySelector("[data-retail-money]")).toHaveTextContent("$3.200");
  });

  it("mini: tapa informativa (no aria-hidden) y sin texto repetido", () => {
    const { container } = render(<Portada principal={item("Akira", { tomo: { serie: "Akira", volumen: 1, autor: "Katsuhiro Otomo" }, precioCents: 500000 })} tamano="mini" />);
    const block = container.querySelector('[data-rol="principal"]') as HTMLElement;
    const cover = block.querySelector("[data-retail-cover]")!;
    expect(cover.closest('[aria-hidden="true"]')).toBeNull();
    // En mini no se muestran autor ni precio (reflejo de tapas).
    expect(within(block).queryByText("Katsuhiro Otomo")).toBeNull();
    expect(block.querySelector("[data-retail-money]")).toBeNull();
  });

  it("las secundarias van en una lista <ul>/<li>", () => {
    const { container } = render(<Portada principal={item("A")} secundarias={[item("B"), item("C")]} />);
    const ul = container.querySelector("ul[data-retail-portada-secundarias]")!;
    expect(ul).toBeInTheDocument();
    expect(ul.querySelectorAll(":scope > li")).toHaveLength(2);
  });

  it("la composición no es clickeable (contenedor neutro)", () => {
    const { container } = render(<Portada principal={item("A")} />);
    expect(container.querySelector("[data-retail-portada]")!.tagName).toBe("DIV");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
