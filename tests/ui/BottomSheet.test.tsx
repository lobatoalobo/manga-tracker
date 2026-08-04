import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomSheet } from "@/components/retail/ui/BottomSheet";

describe("BottomSheet", () => {
  it("render condicional: nada cerrada, dialog modal abierta", () => {
    const { rerender } = render(
      <BottomSheet abierta={false} onCerrar={() => {}}>
        contenido
      </BottomSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <BottomSheet abierta onCerrar={() => {}}>
        contenido
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("rotulado: aria-labelledby con titulo, aria-label como fallback", () => {
    const { rerender } = render(
      <BottomSheet abierta onCerrar={() => {}} titulo="Tu pedido">
        x
      </BottomSheet>,
    );
    expect(screen.getByRole("dialog", { name: "Tu pedido" })).toBeInTheDocument();
    rerender(
      <BottomSheet abierta onCerrar={() => {}} ariaLabel="Reserva">
        x
      </BottomSheet>,
    );
    expect(screen.getByRole("dialog", { name: "Reserva" })).toBeInTheDocument();
  });

  it("foco inicial: el diálogo recibe el foco al abrir", () => {
    render(
      <BottomSheet abierta onCerrar={() => {}} titulo="T">
        x
      </BottomSheet>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("Escape dispara onCerrar", () => {
    const onCerrar = vi.fn();
    render(
      <BottomSheet abierta onCerrar={onCerrar}>
        x
      </BottomSheet>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("click en el overlay cierra; click en el contenido no", () => {
    const onCerrar = vi.fn();
    render(
      <BottomSheet abierta onCerrar={onCerrar}>
        <p>adentro</p>
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByText("adentro"));
    expect(onCerrar).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!); // overlay
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("el botón Cerrar dispara onCerrar", () => {
    const onCerrar = vi.fn();
    render(
      <BottomSheet abierta onCerrar={onCerrar}>
        x
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("renderiza children y acciones", () => {
    render(
      <BottomSheet abierta onCerrar={() => {}} acciones={<button>Hacer pedido</button>}>
        <p>lo que reservás</p>
      </BottomSheet>,
    );
    expect(screen.getByText("lo que reservás")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hacer pedido" })).toBeInTheDocument();
  });

  it("bloqueo reversible del scroll del body", () => {
    const { rerender } = render(
      <BottomSheet abierta={false} onCerrar={() => {}}>
        x
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe("");
    rerender(
      <BottomSheet abierta onCerrar={() => {}}>
        x
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <BottomSheet abierta={false} onCerrar={() => {}}>
        x
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe("");
  });

  it("restaura el foco al elemento previo al cerrar", () => {
    const Harness = ({ abierta }: { abierta: boolean }) => (
      <>
        <button>disparador</button>
        <BottomSheet abierta={abierta} onCerrar={() => {}}>
          x
        </BottomSheet>
      </>
    );
    const { rerender } = render(<Harness abierta={false} />);
    const trigger = screen.getByRole("button", { name: "disparador" });
    trigger.focus();
    expect(trigger).toHaveFocus();
    rerender(<Harness abierta />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    rerender(<Harness abierta={false} />);
    expect(trigger).toHaveFocus();
  });
});
