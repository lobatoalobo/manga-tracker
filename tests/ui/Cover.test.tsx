import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Cover } from "@/components/retail/ui/Cover";

// data-URI SVG self-contained (CSP-safe): sirve como `imagen` sin red.
const IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>');

describe("Cover", () => {
  it("sin imagen: greybox con serie + volumen (nombre accesible por texto)", () => {
    const { container } = render(<Cover serie="Chainsaw Man" volumen={17} />);
    expect(screen.getByText("Chainsaw Man")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    const box = container.querySelector("[data-retail-cover]")!;
    expect(box).toHaveAttribute("data-mode", "greybox");
    expect(box).toHaveAttribute("data-size", "md"); // default
    expect(box).toHaveAttribute("data-state", "normal"); // default
    expect(container.querySelector("img")).toBeNull();
  });

  it("el tamaño y el estado visual se exponen como data-attrs", () => {
    const { container } = render(<Cover serie="Berserk" volumen={41} size="xl" estadoVisual="faltante" />);
    const box = container.querySelector("[data-retail-cover]")!;
    expect(box).toHaveAttribute("data-size", "xl");
    expect(box).toHaveAttribute("data-state", "faltante");

    const { container: c2 } = render(<Cover serie="Berserk" volumen={41} estadoVisual="atenuada" />);
    expect(c2.querySelector("[data-retail-cover]")).toHaveAttribute("data-state", "atenuada");
  });

  it("con imagen: renderiza <img> con alt = serie + volumen", () => {
    render(<Cover serie="Chainsaw Man" volumen={17} imagen={IMG} />);
    const img = screen.getByRole("img", { name: "Chainsaw Man 17" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("ante error de carga cae al greybox (fallback visible)", () => {
    const { container } = render(<Cover serie="Chainsaw Man" volumen={17} imagen={IMG} />);
    expect(container.querySelector("[data-retail-cover]")).toHaveAttribute("data-mode", "image");
    fireEvent.error(screen.getByRole("img"));
    expect(container.querySelector("[data-retail-cover]")).toHaveAttribute("data-mode", "greybox");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Chainsaw Man")).toBeInTheDocument();
  });

  it("sin volumen (con imagen): alt = solo la serie", () => {
    render(<Cover serie="Akira" imagen={IMG} />);
    expect(screen.getByRole("img", { name: "Akira" })).toBeInTheDocument();
  });

  it("sin volumen (greybox): muestra solo la serie, sin número de tomo", () => {
    const { container } = render(<Cover serie="Akira" />);
    const box = container.querySelector("[data-retail-cover]")!;
    expect(box.textContent).toBe("Akira");
  });
});
