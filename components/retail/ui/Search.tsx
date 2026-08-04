"use client";

import { useRef } from "react";
import type { CSSProperties } from "react";

// C-11 · Search — captura la consulta por nombre y DELEGA. No filtra, no conoce
// personas/pedidos, no renderiza resultados (los pone la pantalla). Controlado.

const wrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--hair-2)",
  borderRadius: 999,
  padding: "6px 10px",
  background: "var(--card)",
};

export function Search({
  valor,
  onChange,
  placeholder,
  disabled = false,
  onSubmit,
  ariaLabel = "Buscar por nombre",
}: {
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: (valor: string) => void;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      role="search"
      data-retail-search
      style={{ ...wrap, opacity: disabled ? 0.5 : 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(valor);
      }}
    >
      <input
        ref={inputRef}
        type="search"
        value={valor}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          border: 0,
          outline: "none",
          background: "transparent",
          fontFamily: "var(--sans)",
          fontSize: 14,
          color: "var(--ink)",
        }}
      />
      {valor ? (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          disabled={disabled}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          style={{
            flex: "0 0 auto",
            border: 0,
            background: "transparent",
            cursor: disabled ? "default" : "pointer",
            fontFamily: "var(--sans)",
            fontSize: 16,
            lineHeight: 1,
            color: "var(--ink-3)",
            padding: 2,
          }}
        >
          ×
        </button>
      ) : null}
    </form>
  );
}
