import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pill } from "@/components/retail/ui/Pill";

describe("Pill", () => {
  it("sin onClick: es display-only (<span>, sin rol de botón)", () => {
    const { container } = render(<Pill>En venta</Pill>);
    const pill = container.querySelector("[data-retail-pill]")!;
    expect(pill.tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
    expect(pill).toHaveTextContent("En venta");
  });

  it("con onClick: es <button> nativo y dispara al click", () => {
    const onClick = vi.fn();
    render(
      <Pill prefijo="+" onClick={onClick}>
        Chainsaw Man 18
      </Pill>,
    );
    const btn = screen.getByRole("button", { name: /Chainsaw Man 18/ });
    expect(btn.tagName).toBe("BUTTON");
    btn.focus();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("expone el tono como data-tono", () => {
    const { container } = render(<Pill tono="go">Pagado</Pill>);
    expect(container.querySelector("[data-retail-pill]")).toHaveAttribute("data-tono", "go");

    const { container: c2 } = render(<Pill tono="warn">Falta pagar</Pill>);
    expect(c2.querySelector("[data-retail-pill]")).toHaveAttribute("data-tono", "warn");
  });

  it("el dot es decorativo (aria-hidden) y el prefijo se renderiza", () => {
    const { container } = render(
      <Pill dot prefijo="+">
        Sugerida
      </Pill>,
    );
    const decorativos = container.querySelectorAll('[aria-hidden="true"]');
    // dot + prefijo → 2 elementos decorativos, ninguno anunciado por AT.
    expect(decorativos.length).toBe(2);
    expect(container.querySelector("[data-retail-pill]")).toHaveTextContent("+Sugerida");
  });
});
