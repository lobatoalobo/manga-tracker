import type { CSSProperties } from "react";
import { formatArsCents } from "@/lib/retail/format";

// C-02 · Money — muestra un monto de forma consistente desde CENTAVOS.
// Presentacional puro: no calcula, no conoce el modo de pago. El nombre `cents`
// es la garantía de unidad; el render SIEMPRE pasa por formatArsCents (÷100).
// Negativos y monedas ≠ ARS quedan fuera de C3 (las superficies actuales son ≥0).

export type MoneyVariant = "inline" | "total";

const BASE: CSSProperties = {
  fontFamily: "var(--mono)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const VARIANT_STYLE: Record<MoneyVariant, CSSProperties> = {
  inline: { fontSize: 14, color: "var(--ink)" },
  total: { fontSize: 20, fontWeight: 600, color: "var(--ink)", letterSpacing: "-.01em" },
};

export function Money({ cents, variant = "inline" }: { cents: number; variant?: MoneyVariant }) {
  return (
    <span data-retail-money data-variant={variant} style={{ ...BASE, ...VARIANT_STYLE[variant] }}>
      {formatArsCents(cents)}
    </span>
  );
}
