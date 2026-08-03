import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "@/components/retail/ui/Button";

describe("Button", () => {
  it("renderiza children y dispara onClick al click", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Apartar y avisar</Button>);
    const btn = screen.getByRole("button", { name: "Apartar y avisar" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("es un <button> nativo, recibe foco (activable por teclado)", () => {
    render(<Button>Publicar</Button>);
    const btn = screen.getByRole("button", { name: "Publicar" });
    expect(btn.tagName).toBe("BUTTON");
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it("disabled: no dispara onClick y expone el atributo", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Cerrar
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Cerrar" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading: aria-busy, deshabilitado y sin disparar onClick", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Cancelando…
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Cancelando…" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("expone variante y tamaño como data-attrs; type se propaga", () => {
    const { container } = render(
      <Button variant="warn" size="small" type="submit">
        Dar de baja
      </Button>,
    );
    const btn = container.querySelector("[data-retail-button]")!;
    expect(btn).toHaveAttribute("data-variant", "warn");
    expect(btn).toHaveAttribute("data-size", "small");
    expect(btn).toHaveAttribute("type", "submit");
  });

  it("ariaLabel nombra un botón solo-ícono", () => {
    render(<Button ariaLabel="Quitar tomo">×</Button>);
    expect(screen.getByRole("button", { name: "Quitar tomo" })).toBeInTheDocument();
  });
});
