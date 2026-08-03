import type { CSSProperties, ReactNode } from "react";

// C-01 · Button — dispara la acción primaria o secundaria. El contenido DESCRIBE
// la acción (D-017). Presentacional: no navega, no orquesta async; el caller es
// dueño de useTransition y del texto de "ocupado". <button> nativo, nunca link.

export type ButtonVariant = "primary" | "ghost" | "warn";
export type ButtonSize = "default" | "small";

const BASE: CSSProperties = {
  fontFamily: "var(--sans)",
  fontWeight: 600,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  borderRadius: 999,
  borderWidth: 1.5,
  borderStyle: "solid",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background .12s, border-color .12s, color .12s, opacity .12s",
};

const SIZE_STYLE: Record<ButtonSize, CSSProperties> = {
  default: { fontSize: 14, padding: "9px 18px" },
  small: { fontSize: 12.5, padding: "6px 12px" },
};

const VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: { background: "var(--ink)", borderColor: "var(--ink)", color: "var(--paper)" },
  ghost: { background: "transparent", borderColor: "var(--hair-2)", color: "var(--ink)" },
  warn: { background: "transparent", borderColor: "var(--warn)", color: "var(--warn)" },
};

export function Button({
  children,
  variant = "primary",
  size = "default",
  type = "button",
  disabled = false,
  loading = false,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const inactive = disabled || loading;
  const style: CSSProperties = {
    ...BASE,
    ...SIZE_STYLE[size],
    ...VARIANT_STYLE[variant],
    ...(inactive ? { opacity: 0.5, cursor: "not-allowed" } : null),
  };

  return (
    <button
      type={type}
      data-retail-button
      data-variant={variant}
      data-size={size}
      disabled={inactive}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  );
}
