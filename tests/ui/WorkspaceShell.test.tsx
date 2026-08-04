import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { WorkspaceShell, type EdicionHeader } from "@/components/retail/ui/WorkspaceShell";

const edicion: EdicionHeader = { numero: 81, semana: "semana del 12/08", estado: { label: "En preventa", tono: "mark" } };

describe("WorkspaceShell", () => {
  it("expone landmarks: header, nav etiquetada, main y un único h1", () => {
    const { container } = render(
      <WorkspaceShell edicion={edicion} faseActual="preventa">
        <p>contenido</p>
      </WorkspaceShell>,
    );
    expect(container.querySelector("header")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Fases de la edición" })).toBeInTheDocument();
    expect(container.querySelector("main")).toBeInTheDocument();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("masthead: número, semana y Pill de estado con la etiqueta provista", () => {
    render(
      <WorkspaceShell edicion={edicion} faseActual="preventa">
        <p>x</p>
      </WorkspaceShell>,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("#81");
    expect(h1).toHaveTextContent("semana del 12/08");
    expect(screen.getByText("En preventa").closest("[data-retail-pill]")).not.toBeNull();
  });

  it("nav activa: aria-current='page' en la fase actual", () => {
    render(
      <WorkspaceShell edicion={edicion} faseActual="preparacion">
        <p>x</p>
      </WorkspaceShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Fases de la edición" });
    const activa = within(nav).getByRole("button", { name: "Preparación" });
    expect(activa).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Preventa" })).not.toHaveAttribute("aria-current");
  });

  it("fases no disponibles quedan disabled", () => {
    render(
      <WorkspaceShell edicion={edicion} faseActual="creacion" fasesDisponibles={["creacion", "preventa"]}>
        <p>x</p>
      </WorkspaceShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Fases de la edición" });
    expect(within(nav).getByRole("button", { name: "Entrega" })).toBeDisabled();
    expect(within(nav).getByRole("button", { name: "Preventa" })).not.toBeDisabled();
  });

  it("onNavegar: dispara con la fase navegable; no con la activa ni la disabled", () => {
    const onNavegar = vi.fn();
    render(
      <WorkspaceShell edicion={edicion} faseActual="preventa" fasesDisponibles={["preventa", "cierre"]} onNavegar={onNavegar}>
        <p>x</p>
      </WorkspaceShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Fases de la edición" });
    fireEvent.click(within(nav).getByRole("button", { name: "Cierre" }));
    expect(onNavegar).toHaveBeenCalledWith("cierre");
    onNavegar.mockClear();
    fireEvent.click(within(nav).getByRole("button", { name: "Preventa" })); // activa
    fireEvent.click(within(nav).getByRole("button", { name: "Entrega" })); // disabled
    expect(onNavegar).not.toHaveBeenCalled();
  });

  it("slots: children en main; aside en dos columnas; pie presente", () => {
    const { container } = render(
      <WorkspaceShell edicion={edicion} faseActual="creacion" aside={<p>panel</p>} pie={<div>barra</div>}>
        <p>principal</p>
      </WorkspaceShell>,
    );
    const main = container.querySelector("main")!;
    expect(within(main).getByText("principal")).toBeInTheDocument();
    expect(main).toHaveAttribute("data-columnas", "2");
    expect(container.querySelector("aside[data-retail-shell-aside]")).toHaveTextContent("panel");
    expect(container.querySelector("[data-retail-shell-pie]")).toHaveTextContent("barra");
  });

  it("una columna cuando no hay aside", () => {
    const { container } = render(
      <WorkspaceShell edicion={edicion} faseActual="creacion">
        <p>solo</p>
      </WorkspaceShell>,
    );
    expect(container.querySelector("main")).toHaveAttribute("data-columnas", "1");
    expect(container.querySelector("aside")).toBeNull();
  });

  it("orden de lectura: header antes que main antes que pie", () => {
    const { container } = render(
      <WorkspaceShell edicion={edicion} faseActual="entrega" pie={<div>pie</div>}>
        <p>c</p>
      </WorkspaceShell>,
    );
    const kids = Array.from(container.querySelector("[data-retail-shell]")!.children).map((n) => n.tagName.toLowerCase());
    expect(kids).toEqual(["header", "main", "div"]);
  });

  it("masthead con titulo: muestra el título (sin '#') cuando se provee, no el número", () => {
    render(
      <WorkspaceShell edicion={{ titulo: "Kagurabachi — semana 3", semana: "12/08", estado: { label: "Borrador" } }} faseActual="creacion">
        <p>x</p>
      </WorkspaceShell>,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Kagurabachi — semana 3");
    expect(h1).toHaveTextContent("12/08");
    expect(h1.textContent).not.toContain("#");
  });

  it("fasesVisibles: renderiza SOLO las fases indicadas en la nav", () => {
    render(
      <WorkspaceShell edicion={edicion} faseActual="creacion" fasesVisibles={["creacion"]}>
        <p>x</p>
      </WorkspaceShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Fases de la edición" });
    expect(within(nav).getByRole("button", { name: "Creación" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Preventa" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Entrega" })).toBeNull();
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
  });

  it("sin dominio: renderiza el estado.label provisto tal cual (no mapea)", () => {
    render(
      <WorkspaceShell edicion={{ numero: 9, semana: "s", estado: { label: "Etiqueta arbitraria" } }} faseActual="preventa">
        <p>x</p>
      </WorkspaceShell>,
    );
    expect(screen.getByText("Etiqueta arbitraria")).toBeInTheDocument();
  });
});
