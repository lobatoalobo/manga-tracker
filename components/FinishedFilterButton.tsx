"use client";

import { useState } from "react";
import Link from "next/link";

const HINT = "Seleccioná A-Z para habilitar";

/**
 * Botón "Solo terminadas". Siempre visible: habilitado solo en el tab A-Z;
 * en el resto se ve deshabilitado y muestra un tooltip (hover en desktop, tap
 * en mobile) explicando que hay que entrar a A-Z.
 */
export default function FinishedFilterButton({
  enabled,
  active,
}: {
  enabled: boolean;
  active: boolean;
}) {
  const [showTip, setShowTip] = useState(false);

  if (enabled) {
    return (
      <Link
        href={active ? "/?tab=az" : "/?tab=az&finished=1"}
        className={`ml-1 rounded-lg px-3 py-2 text-sm transition ${
          active
            ? "bg-accent text-white"
            : "border border-border text-muted hover:text-foreground"
        }`}
      >
        ✓ Solo terminadas
      </Link>
    );
  }

  return (
    <span className="group relative ml-1">
      <button
        type="button"
        aria-disabled="true"
        title={HINT}
        onClick={() => {
          setShowTip(true);
          setTimeout(() => setShowTip(false), 2500);
        }}
        className="cursor-not-allowed rounded-lg border border-border px-3 py-2 text-sm text-muted opacity-40"
      >
        ✓ Solo terminadas
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground shadow-lg group-hover:block ${
          showTip ? "block" : "hidden"
        }`}
      >
        {HINT}
      </span>
    </span>
  );
}
