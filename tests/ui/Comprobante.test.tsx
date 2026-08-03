import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Comprobante } from "@/components/retail/ui/Comprobante";

describe("Comprobante", () => {
  it("cliente · sin-comprobante: ofrece el input de archivo con label accesible", () => {
    render(<Comprobante contexto="cliente" estado="sin-comprobante" onSeleccionar={() => {}} />);
    const input = screen.getByLabelText("Adjuntar comprobante");
    expect(input).toHaveAttribute("type", "file");
  });

  it("el input de archivo captura el File y llama onSeleccionar", () => {
    const onSeleccionar = vi.fn();
    render(<Comprobante contexto="cliente" estado="sin-comprobante" onSeleccionar={onSeleccionar} />);
    const input = screen.getByLabelText("Adjuntar comprobante") as HTMLInputElement;
    const file = new File(["data"], "comprobante.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onSeleccionar.mock.calls[0][0].name).toBe("comprobante.jpg");
  });

  it("cliente · seleccionado: muestra el nombre y ofrece Quitar + Enviar", () => {
    const onQuitar = vi.fn();
    const onEnviar = vi.fn();
    render(
      <Comprobante
        contexto="cliente"
        estado="seleccionado"
        archivo={{ nombre: "transferencia-1234.pdf" }}
        onQuitar={onQuitar}
        onEnviar={onEnviar}
      />,
    );
    expect(screen.getByText("transferencia-1234.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar comprobante" }));
    expect(onQuitar).toHaveBeenCalledTimes(1);
    expect(onEnviar).toHaveBeenCalledTimes(1);
  });

  it("cliente · enviado: estado 'Por validar' con role=status, sin acciones de tienda", () => {
    render(<Comprobante contexto="cliente" estado="enviado" archivo={{ nombre: "comp.jpg", fecha: "12/08" }} />);
    const status = screen.getByRole("status");
    expect(within(status).getByText("Por validar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar pago" })).toBeNull();
  });

  it("tienda · enviado: ofrece Ver / Confirmar / Rechazar y dispara los callbacks", () => {
    const onVer = vi.fn();
    const onConfirmar = vi.fn();
    const onRechazar = vi.fn();
    render(
      <Comprobante
        contexto="tienda"
        estado="enviado"
        archivo={{ nombre: "comp.jpg" }}
        onVer={onVer}
        onConfirmar={onConfirmar}
        onRechazar={onRechazar}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ver comprobante" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(onVer).toHaveBeenCalledTimes(1);
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onRechazar).toHaveBeenCalledTimes(1);
  });

  it("botones solo si el callback existe (tienda · enviado sin onRechazar)", () => {
    render(<Comprobante contexto="tienda" estado="enviado" archivo={{ nombre: "c.jpg" }} onConfirmar={() => {}} />);
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver comprobante" })).toBeNull();
  });

  it("confirmado: texto visible 'Pagado' (no solo color)", () => {
    render(<Comprobante contexto="tienda" estado="confirmado" archivo={{ nombre: "c.jpg" }} />);
    expect(screen.getByText("Pagado")).toBeInTheDocument();
  });

  it("rechazado: texto 'Rechazado', motivo por `nota` y re-adjuntar", () => {
    render(
      <Comprobante
        contexto="cliente"
        estado="rechazado"
        nota="El monto no coincide con el pedido."
        onSeleccionar={() => {}}
      />,
    );
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
    expect(screen.getByText("El monto no coincide con el pedido.")).toBeInTheDocument();
    expect(screen.getByLabelText("Adjuntar comprobante")).toBeInTheDocument();
  });

  it("controlado: enviar dispara el callback pero el estado renderizado no cambia solo", () => {
    const onEnviar = vi.fn();
    const { container } = render(
      <Comprobante contexto="cliente" estado="seleccionado" archivo={{ nombre: "c.pdf" }} onEnviar={onEnviar} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar comprobante" }));
    expect(onEnviar).toHaveBeenCalledTimes(1);
    // Sin lógica de dominio interna: sigue en "seleccionado".
    expect(container.querySelector("[data-retail-comprobante]")).toHaveAttribute("data-estado", "seleccionado");
  });
});
