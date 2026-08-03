import type { CSSProperties, ReactNode } from "react";

// C-04 · Pill — píldora de etiqueta, informativa o accionable. REFLEJA estado;
// no lo decide (la verdad vive en el dominio). Sin onClick → <span> de solo
// lectura; con onClick → <button> nativo. Unifica StatusPill/Chip/PayChip.

export type PillTono = "neutral" | "mark" | "warn" | "go";

const TONO_STYLE: Record<PillTono, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: "var(--hair)", fg: "var(--ink-2)", dot: "var(--ink-3)" },
  mark: { bg: "var(--mark-soft)", fg: "var(--mark)", dot: "var(--mark)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "var(--warn)" },
  go: { bg: "var(--go-soft)", fg: "var(--go)", dot: "var(--go)" },
};

function baseStyle(tono: PillTono): CSSProperties {
  const t = TONO_STYLE[tono];
  return {
    fontFamily: "var(--sans)",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    background: t.bg,
    color: t.fg,
    whiteSpace: "nowrap",
  };
}

export function Pill({
  children,
  tono = "neutral",
  dot = false,
  prefijo,
  onClick,
}: {
  children: ReactNode;
  tono?: PillTono;
  dot?: boolean;
  prefijo?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      {dot ? (
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: 999, background: TONO_STYLE[tono].dot, flex: "0 0 auto" }}
        />
      ) : null}
      {prefijo ? <span aria-hidden style={{ fontFamily: "var(--mono)" }}>{prefijo}</span> : null}
      <span>{children}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" data-retail-pill data-tono={tono} onClick={onClick} style={{ ...baseStyle(tono), border: 0, cursor: "pointer" }}>
        {content}
      </button>
    );
  }

  return (
    <span data-retail-pill data-tono={tono} style={baseStyle(tono)}>
      {content}
    </span>
  );
}
