import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/retail/ui/Button";
import { Pill, type PillTono } from "@/components/retail/ui/Pill";

// C-07 · Comprobante — artefacto de la evidencia de pago: adjuntar/enviar (cliente)
// y ver/confirmar/rechazar (tienda). CONTROLADO: recibe estado + callbacks; no
// decide estados ni ejecuta transiciones de dominio. Nakama no procesa dinero: el
// comprobante es evidencia que valida una persona (sin OCR/banco). El monto vive
// fuera, en `referencia` (la pantalla pasa <Money/>). Depende de Button + Pill.

export type ComprobanteContexto = "cliente" | "tienda";
export type ComprobanteEstado = "sin-comprobante" | "seleccionado" | "enviado" | "confirmado" | "rechazado";
export type ComprobanteArchivo = { nombre: string; fecha?: string };

// Etiqueta + tono del Pill de estado (texto SIEMPRE visible, no solo color).
const ESTADO_PILL: Partial<Record<ComprobanteEstado, { label: string; tono: PillTono }>> = {
  enviado: { label: "Por validar", tono: "warn" },
  confirmado: { label: "Pagado", tono: "go" },
  rechazado: { label: "Rechazado", tono: "warn" },
};

// input file visualmente oculto pero FOCUSABLE (patrón sr-only; no display:none).
const SR_ONLY_INPUT: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const FILE_LABEL: CSSProperties = {
  fontFamily: "var(--sans)",
  fontWeight: 600,
  fontSize: 14,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  border: "1.5px solid var(--ink)",
  background: "var(--ink)",
  color: "var(--paper)",
  padding: "9px 18px",
  cursor: "pointer",
};

const nombreStyle: CSSProperties = { fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fechaStyle: CSSProperties = { fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" };
const notaStyle: CSSProperties = { fontFamily: "var(--sans)", fontSize: 12, color: "var(--warn)" };

function FileTrigger({ label, onSeleccionar }: { label: string; onSeleccionar?: (file: File) => void }) {
  return (
    <label style={{ ...FILE_LABEL, position: "relative" }}>
      <span>{label}</span>
      <input
        type="file"
        style={SR_ONLY_INPUT}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onSeleccionar) onSeleccionar(file);
        }}
      />
    </label>
  );
}

export function Comprobante({
  contexto,
  estado,
  archivo,
  referencia,
  nota,
  onSeleccionar,
  onQuitar,
  onEnviar,
  onVer,
  onConfirmar,
  onRechazar,
}: {
  contexto: ComprobanteContexto;
  estado: ComprobanteEstado;
  archivo?: ComprobanteArchivo;
  referencia?: ReactNode;
  nota?: ReactNode;
  onSeleccionar?: (file: File) => void;
  onQuitar?: () => void;
  onEnviar?: () => void;
  onVer?: () => void;
  onConfirmar?: () => void;
  onRechazar?: () => void;
}) {
  const pill = ESTADO_PILL[estado];
  const verBtn = onVer ? (
    <Button variant="ghost" size="small" onClick={onVer}>
      Ver comprobante
    </Button>
  ) : null;

  return (
    <div
      data-retail-comprobante
      data-contexto={contexto}
      data-estado={estado}
      style={{ display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--hair)", borderRadius: 10, padding: 14, background: "var(--card)" }}
    >
      {/* Estado + nombre de archivo. role=status → se anuncia al cambiar. */}
      <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {pill ? <Pill tono={pill.tono}>{pill.label}</Pill> : null}
        {archivo ? (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={nombreStyle}>{archivo.nombre}</span>
            {archivo.fecha ? <span style={fechaStyle}>{archivo.fecha}</span> : null}
          </span>
        ) : null}
        {referencia ? <span style={{ marginLeft: "auto" }}>{referencia}</span> : null}
      </div>

      {nota ? <div style={notaStyle}>{nota}</div> : null}

      {/* Acciones según contexto × estado; cada botón solo si su callback existe. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {contexto === "cliente" && (estado === "sin-comprobante" || estado === "rechazado") ? (
          <FileTrigger label="Adjuntar comprobante" onSeleccionar={onSeleccionar} />
        ) : null}

        {contexto === "cliente" && estado === "seleccionado" ? (
          <>
            {onQuitar ? (
              <Button variant="ghost" size="small" onClick={onQuitar}>
                Quitar
              </Button>
            ) : null}
            {onEnviar ? <Button onClick={onEnviar}>Enviar comprobante</Button> : null}
          </>
        ) : null}

        {contexto === "cliente" && (estado === "enviado" || estado === "confirmado") ? verBtn : null}

        {contexto === "tienda" && estado === "enviado" ? (
          <>
            {verBtn}
            {onConfirmar ? <Button onClick={onConfirmar}>Confirmar pago</Button> : null}
            {onRechazar ? (
              <Button variant="warn" onClick={onRechazar}>
                Rechazar
              </Button>
            ) : null}
          </>
        ) : null}

        {contexto === "tienda" && estado === "confirmado" ? verBtn : null}
      </div>
    </div>
  );
}
