import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money } from "@/components/retail/ui/Money";

describe("Money", () => {
  it("formatea desde CENTAVOS (no pesos): 320000 → $3.200", () => {
    const { container } = render(<Money cents={320000} />);
    const el = container.querySelector("[data-retail-money]")!;
    expect(el).toHaveTextContent("$3.200");
    // Garantía de unidad: si tratara el número como pesos daría $320.000.
    expect(el.textContent).not.toBe("$320.000");
  });

  it("muestra el cero como $0", () => {
    const { container } = render(<Money cents={0} />);
    expect(container.querySelector("[data-retail-money]")).toHaveTextContent("$0");
  });

  it("expone la variante para el énfasis visual", () => {
    const { container, rerender } = render(<Money cents={100000} variant="inline" />);
    expect(container.querySelector("[data-retail-money]")).toHaveAttribute("data-variant", "inline");
    rerender(<Money cents={100000} variant="total" />);
    expect(container.querySelector("[data-retail-money]")).toHaveAttribute("data-variant", "total");
  });

  it("el texto accesible es el mismo valor visible", () => {
    render(<Money cents={450000} />);
    // El monto formateado es contenido de texto real: lo lee un lector de pantalla.
    expect(screen.getByText("$4.500")).toBeInTheDocument();
  });
});
