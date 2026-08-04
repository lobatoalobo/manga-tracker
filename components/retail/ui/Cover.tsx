"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

// C-03 · Cover — representa visualmente un tomo (la tapa). Hoy el modo dominante
// es un greybox tipográfico (serie + volumen); si llega `imagen`, la muestra con
// <img> y el greybox queda de fallback visible durante la carga y ante error.
// Proporción fija de tapa (~2:3); el estado semántico lo dice el Pill, no la tapa.

export type CoverState = "normal" | "faltante" | "atenuada";
export type CoverSize = "xs" | "sm" | "md" | "lg" | "xl";

const DIM: Record<CoverSize, { w: number; h: number; serie: number; vol: number }> = {
  xs: { w: 24, h: 34, serie: 7, vol: 9 },
  sm: { w: 36, h: 51, serie: 8, vol: 11 },
  md: { w: 48, h: 68, serie: 10, vol: 14 },
  lg: { w: 60, h: 85, serie: 11, vol: 17 },
  xl: { w: 74, h: 110, serie: 13, vol: 22 },
};

// Filtro/opacidad del estado visual, aplicado a toda la caja (img + greybox).
const STATE_FILTER: Record<CoverState, CSSProperties> = {
  normal: {},
  faltante: { filter: "grayscale(1)" },
  atenuada: { opacity: 0.5 },
};

function altText(serie: string, volumen?: number | string): string {
  const v = volumen === undefined || volumen === "" ? "" : ` ${volumen}`;
  return `${serie}${v}`;
}

export function Cover({
  serie,
  volumen,
  imagen,
  estadoVisual = "normal",
  size = "md",
}: {
  serie: string;
  volumen?: number | string;
  imagen?: string;
  estadoVisual?: CoverState;
  size?: CoverSize;
}) {
  const [errored, setErrored] = useState(false);
  const dim = DIM[size];
  const showImage = Boolean(imagen) && !errored;

  const box: CSSProperties = {
    position: "relative",
    width: dim.w,
    height: dim.h,
    maxWidth: "100%",
    flex: "0 0 auto",
    borderRadius: 3,
    overflow: "hidden",
    border: "1px solid var(--hair)",
    background: "var(--card)",
    ...STATE_FILTER[estadoVisual],
  };

  const greybox: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: 4,
    textAlign: "center",
    color: "var(--ink-2)",
    background: "var(--paper-2)",
  };

  return (
    <div data-retail-cover data-size={size} data-state={estadoVisual} data-mode={showImage ? "image" : "greybox"} style={box}>
      {/* Greybox: capa base. Visible mientras la imagen carga y como fallback. */}
      <span aria-hidden={showImage ? true : undefined} style={greybox}>
        <span style={{ fontFamily: "var(--serif)", fontSize: dim.serie, lineHeight: 1.1, color: "var(--ink)", overflow: "hidden" }}>
          {serie}
        </span>
        {volumen !== undefined && volumen !== "" ? (
          <span style={{ fontFamily: "var(--mono)", fontSize: dim.vol, fontWeight: 600, color: "var(--ink)" }}>{volumen}</span>
        ) : null}
      </span>
      {showImage ? (
        <img
          src={imagen}
          alt={altText(serie, volumen)}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : null}
    </div>
  );
}
