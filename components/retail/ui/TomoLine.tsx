import type { CSSProperties, ReactNode } from "react";
import { Cover, type CoverState } from "@/components/retail/ui/Cover";
import { Money } from "@/components/retail/ui/Money";

// C-05 · TomoLine — una fila que compone tapa + identidad + (cantidad/precio
// read-only) + un SLOT de acción inyectado por la pantalla. No conoce operaciones
// (portada, cantidades, faltantes, reservar): entran por `accion`. No conoce el
// pedido ni el total. Depende de Cover (C-03) y Money (C-02).

export type TomoLineTomo = { serie: string; volumen?: number | string; autor?: string; imagen?: string };
export type TomoLineEstado = "normal" | "sin-precio" | "faltante" | "atenuada";

// El estado de la fila mapea al de la tapa solo en los ejes que la tapa entiende.
const COVER_STATE: Record<TomoLineEstado, CoverState> = {
  normal: "normal",
  "sin-precio": "normal",
  faltante: "faltante",
  atenuada: "atenuada",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--serif)",
  fontSize: 15,
  color: "var(--ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const secondaryStyle: CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 12,
  color: "var(--ink-2)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export function TomoLine({
  tomo,
  cantidad,
  precioCents,
  aux,
  accion,
  estadoVisual = "normal",
}: {
  tomo: TomoLineTomo;
  cantidad?: number;
  precioCents?: number;
  aux?: ReactNode;
  accion?: ReactNode;
  estadoVisual?: TomoLineEstado;
}) {
  const sinPrecio = estadoVisual === "sin-precio";
  const row: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 10px",
    borderRadius: 8,
    border: sinPrecio ? "1px dashed var(--warn)" : "1px solid transparent",
    opacity: estadoVisual === "atenuada" ? 0.55 : 1,
  };

  return (
    <div data-retail-tomoline data-estado={estadoVisual} style={row}>
      {/* Tapa decorativa: la fila ya muestra el título como texto → aria-hidden
          evita duplicar el nombre accesible (alt del <img> o texto del greybox). */}
      <span aria-hidden style={{ flex: "0 0 auto" }}>
        <Cover serie={tomo.serie} volumen={tomo.volumen} imagen={tomo.imagen} estadoVisual={COVER_STATE[estadoVisual]} size="sm" />
      </span>

      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div data-retail-tomoline-title style={titleStyle}>
          {tomo.serie}
          {tomo.volumen !== undefined && tomo.volumen !== "" ? (
            <span style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}> · {tomo.volumen}</span>
          ) : null}
        </div>
        {tomo.autor ? <div style={secondaryStyle}>{tomo.autor}</div> : null}
        {aux ? <div style={secondaryStyle}>{aux}</div> : null}
      </div>

      {cantidad !== undefined ? (
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-2)", flex: "0 0 auto" }}>×{cantidad}</span>
      ) : null}

      {sinPrecio ? (
        <span style={{ fontFamily: "var(--sans)", fontSize: 12, fontWeight: 600, color: "var(--warn)", flex: "0 0 auto" }}>Sin precio</span>
      ) : precioCents !== undefined ? (
        <span style={{ flex: "0 0 auto" }}>
          <Money cents={precioCents} />
        </span>
      ) : null}

      {accion ? <span style={{ flex: "0 0 auto", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>{accion}</span> : null}
    </div>
  );
}
