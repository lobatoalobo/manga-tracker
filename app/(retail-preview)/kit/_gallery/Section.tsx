import type { CSSProperties, ReactNode } from "react";

// Andamio reutilizable de la galería del UI Kit (Fase 0 · C2).
// Cada entrada de la galería (tokens ahora; componentes en C3+) se envuelve con
// esta Section. NO es un componente del UI Kit del producto: es infraestructura
// interna del preview. Regla de la galería: cada componente se muestra AISLADO
// con fixtures propias — nunca reconstruyendo una pantalla (P-01…P-08).

const labelStyle: CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 11,
  letterSpacing: ".11em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  margin: "32px 0 12px",
};

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={labelStyle}>{title}</h2>
      {children}
    </section>
  );
}
