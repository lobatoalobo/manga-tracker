"use client";

import { useEffect, useId, useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

// C-10 · BottomSheet — superficie modal inferior sobre la página, controlada, sin
// cambiar de contexto. NO conoce reservas/formularios/contacto: solo la superficie.
// Foco inicial + restauración + Escape + Tab-wrap mínimo + scroll lock reversible.

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  alignItems: "center",
  background: "rgba(0,0,0,.4)",
};

const panel: CSSProperties = {
  width: "100%",
  maxWidth: 480,
  maxHeight: "90dvh",
  display: "flex",
  flexDirection: "column",
  background: "var(--paper)",
  color: "var(--ink)",
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  border: "1px solid var(--hair)",
  boxShadow: "0 -8px 40px rgba(0,0,0,.25)",
};

export function BottomSheet({
  abierta,
  onCerrar,
  titulo,
  descripcion,
  children,
  acciones,
  ariaLabel,
}: {
  abierta: boolean;
  onCerrar: () => void;
  titulo?: ReactNode;
  descripcion?: ReactNode;
  children: ReactNode;
  acciones?: ReactNode;
  ariaLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const tituloId = useId();
  const descId = useId();

  useEffect(() => {
    if (!abierta) return;
    // Guarda el foco previo y mueve el foco al diálogo.
    prevFocus.current = (document.activeElement as HTMLElement) ?? null;
    dialogRef.current?.focus();
    // Bloqueo reversible del scroll del body.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus.current?.focus?.();
    };
  }, [abierta]);

  if (!abierta || typeof document === "undefined") return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onCerrar();
      return;
    }
    if (e.key === "Tab") {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div
      style={overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo ? undefined : ariaLabel}
        aria-labelledby={titulo ? tituloId : undefined}
        aria-describedby={descripcion ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-retail-bottomsheet
        style={panel}
      >
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 16px 8px" }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            {titulo ? (
              <h2 id={tituloId} style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, margin: 0 }}>
                {titulo}
              </h2>
            ) : null}
            {descripcion ? (
              <p id={descId} style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)", margin: "4px 0 0" }}>
                {descripcion}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCerrar}
            style={{ flex: "0 0 auto", border: 0, background: "transparent", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--ink-2)", padding: 4 }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "4px 16px 16px" }}>{children}</div>

        {acciones ? (
          <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end", gap: 8, padding: 16, borderTop: "1px solid var(--hair)" }}>
            {acciones}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
