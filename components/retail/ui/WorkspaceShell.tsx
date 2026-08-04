import type { CSSProperties, ReactNode } from "react";
import { Pill, type PillTono } from "@/components/retail/ui/Pill";

// C-08 · WorkspaceShell — shell estable de las 5 superficies del comerciante:
// identidad de la edición + estado + navegación entre fases + regiones de
// contenido. NO implementa ninguna fase, NO conoce rutas ni el mapeo estado→
// etiqueta (lo recibe), NO computa disponibilidad (la recibe). Llena su padre
// (la página provee el wrapper full-height, p. ej. 100dvh). Depende de Pill.

export type Fase = "creacion" | "preventa" | "cierre" | "preparacion" | "entrega";
export type EdicionHeader = { numero: number | string; semana: string; estado: { label: string; tono?: PillTono } };

// Etiquetas de la nav: vocabulario de UI del workspace (no dominio).
const FASE_LABEL: Record<Fase, string> = {
  creacion: "Creación",
  preventa: "Preventa",
  cierre: "Cierre",
  preparacion: "Preparación",
  entrega: "Entrega",
};
const FASES: readonly Fase[] = ["creacion", "preventa", "cierre", "preparacion", "entrega"];

const shell: CSSProperties = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--paper)", color: "var(--ink)" };

function NavItem({ fase, activa, disponible, onNavegar }: { fase: Fase; activa: boolean; disponible: boolean; onNavegar?: (f: Fase) => void }) {
  const inactiva = !disponible && !activa;
  return (
    <button
      type="button"
      aria-current={activa ? "page" : undefined}
      disabled={inactiva}
      onClick={activa || inactiva ? undefined : () => onNavegar?.(fase)}
      style={{
        fontFamily: "var(--sans)",
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        cursor: activa || inactiva ? "default" : "pointer",
        background: "transparent",
        border: 0,
        padding: "10px 4px",
        color: activa ? "var(--ink)" : "var(--ink-3)",
        borderBottom: `2px solid ${activa ? "var(--mark)" : "transparent"}`,
        opacity: inactiva ? 0.4 : 1,
      }}
    >
      {FASE_LABEL[fase]}
    </button>
  );
}

export function WorkspaceShell({
  edicion,
  faseActual,
  fasesDisponibles,
  onNavegar,
  children,
  aside,
  pie,
}: {
  edicion: EdicionHeader;
  faseActual: Fase;
  fasesDisponibles?: Fase[];
  onNavegar?: (fase: Fase) => void;
  children: ReactNode;
  aside?: ReactNode;
  pie?: ReactNode;
}) {
  const disponibles = fasesDisponibles ?? FASES; // default: todas navegables

  return (
    <div data-retail-shell style={shell}>
      <header style={{ flex: "0 0 auto", padding: "16px 20px 0", borderBottom: "1px solid var(--hair)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <p style={{ fontFamily: "var(--sans)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-3)", margin: 0 }}>Edición</p>
          <h1 style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600, letterSpacing: "-.01em", margin: 0 }}>
            #{edicion.numero} <span style={{ fontFamily: "var(--sans)", fontSize: 14, fontWeight: 400, color: "var(--ink-2)" }}>· {edicion.semana}</span>
          </h1>
          <span style={{ marginLeft: "auto" }}>
            <Pill tono={edicion.estado.tono ?? "neutral"} dot>
              {edicion.estado.label}
            </Pill>
          </span>
        </div>
        <nav aria-label="Fases de la edición" style={{ display: "flex", gap: 18, marginTop: 8, overflowX: "auto" }}>
          {FASES.map((f) => (
            <NavItem key={f} fase={f} activa={f === faseActual} disponible={disponibles.includes(f)} onNavegar={onNavegar} />
          ))}
        </nav>
      </header>

      <main
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "auto",
          padding: 20,
          // Dos columnas con flex-wrap: el aside apila en mobile sin media queries.
          ...(aside ? { display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" } : null),
        }}
        data-columnas={aside ? 2 : 1}
      >
        <div style={{ flex: aside ? "1 1 360px" : undefined, minWidth: 0 }}>{children}</div>
        {aside ? (
          <aside data-retail-shell-aside style={{ flex: "1 1 260px", minWidth: 0 }}>
            {aside}
          </aside>
        ) : null}
      </main>

      {pie ? (
        <div data-retail-shell-pie style={{ flex: "0 0 auto" }}>
          {pie}
        </div>
      ) : null}
    </div>
  );
}
