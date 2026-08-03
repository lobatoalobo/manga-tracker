import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Prueba de INFRAESTRUCTURA (Fase 0 · C2). No prueba un componente del producto:
// verifica que el harness de tests de componentes funciona de punta a punta —
// render en jsdom, matchers de jest-dom, interacción por click y por teclado, y
// gestión de foco. El fixture es intencionalmente interno a este archivo.
const RESET_KEY = "Escape";

function Probe() {
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      aria-label="probe"
      onClick={() => setCount((c) => c + 1)}
      onKeyDown={(e) => {
        if (e.key === RESET_KEY) setCount(0);
      }}
    >
      count: {count}
    </button>
  );
}

describe("component-test harness (jsdom)", () => {
  it("renderiza en jsdom y expone matchers de jest-dom", () => {
    render(<Probe />);
    const button = screen.getByRole("button", { name: "probe" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("count: 0");
  });

  it("responde a click y a teclado, y maneja foco", () => {
    render(<Probe />);
    const button = screen.getByRole("button", { name: "probe" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveTextContent("count: 2");

    button.focus();
    expect(button).toHaveFocus();

    fireEvent.keyDown(button, { key: RESET_KEY });
    expect(button).toHaveTextContent("count: 0");
  });
});
