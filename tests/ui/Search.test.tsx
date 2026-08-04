import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Search } from "@/components/retail/ui/Search";

describe("Search", () => {
  it("input accesible (searchbox) con el label por defecto", () => {
    render(<Search valor="" onChange={() => {}} />);
    const input = screen.getByRole("searchbox", { name: "Buscar por nombre" });
    expect(input).toHaveAttribute("type", "search");
  });

  it("valor controlado: refleja la prop", () => {
    render(<Search valor="Juan" onChange={() => {}} />);
    expect(screen.getByRole("searchbox")).toHaveValue("Juan");
  });

  it("onChange se dispara al escribir con el nuevo valor", () => {
    const onChange = vi.fn();
    render(<Search valor="Ju" onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Jua" } });
    expect(onChange).toHaveBeenCalledWith("Jua");
  });

  it("limpiar: aparece solo con valor y dispara onChange('')", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Search valor="" onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Limpiar búsqueda" })).toBeNull();
    rerender(<Search valor="Juan" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("disabled: input deshabilitado", () => {
    render(<Search valor="x" onChange={() => {}} disabled />);
    expect(screen.getByRole("searchbox")).toBeDisabled();
  });

  it("Enter/submit: dispara onSubmit con el valor cuando se provee", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Search valor="Juan" onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledWith("Juan");
  });

  it("submit sin onSubmit no rompe", () => {
    const { container } = render(<Search valor="Juan" onChange={() => {}} />);
    expect(() => fireEvent.submit(container.querySelector("form")!)).not.toThrow();
  });

  it("sin lógica de filtrado: solo el input, no renderiza resultados", () => {
    const { container } = render(<Search valor="Juan" onChange={() => {}} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("[role='search']")).toBeInTheDocument();
  });
});
