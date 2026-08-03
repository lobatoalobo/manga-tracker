import type { CSSProperties, ReactNode } from "react";

// C-09 · ActionBar — barra de síntesis + acción(es) contextual(es), a veces
// bloqueada con motivo. NO conoce publicar/cerrar/entregar/preparar: recibe
// contenido y acciones por slots. NO calcula el bloqueo (lo recibe). Money/Pill
// se componen dentro de `resumen`/`bloqueo` por la pantalla. Depende de C-00.

const BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "12px 16px",
  borderTop: "1px solid var(--hair)",
  background: "var(--paper-2)",
};

export function ActionBar({
  resumen,
  acciones,
  bloqueo,
  loading = false,
  sticky = false,
}: {
  resumen?: ReactNode;
  acciones?: ReactNode;
  bloqueo?: ReactNode;
  loading?: boolean;
  sticky?: boolean;
}) {
  const style: CSSProperties = {
    ...BASE,
    ...(sticky ? { position: "sticky", bottom: 0, zIndex: 1 } : null),
    ...(bloqueo ? { borderTop: "1px solid var(--warn)" } : null),
  };

  return (
    <div data-retail-actionbar data-bloqueada={bloqueo ? "" : undefined} aria-busy={loading || undefined} style={style}>
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {bloqueo ? (
          <span role="status" style={{ fontFamily: "var(--sans)", fontSize: 12.5, fontWeight: 600, color: "var(--warn)" }}>
            {bloqueo}
          </span>
        ) : null}
        {resumen ? (
          <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)" }}>{resumen}</span>
        ) : null}
      </div>
      {acciones ? <div style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 8 }}>{acciones}</div> : null}
    </div>
  );
}
