"use client";

import { useState } from "react";

/**
 * Texto largo (sinopsis) colapsado por defecto con "Leer más" / "Leer menos".
 * Mobile-first: clampea a unas líneas y deja expandir. Si el texto es corto, no
 * muestra el botón.
 */
export default function ExpandableText({
  text,
  clampLines = 6,
}: {
  text: string;
  clampLines?: number;
}) {
  const [open, setOpen] = useState(false);
  // Heurística simple para decidir si vale el botón (no medimos el DOM).
  const longish = text.length > 320;

  return (
    <div className="mt-6">
      <p
        className="whitespace-pre-wrap text-sm leading-relaxed text-muted"
        style={
          open || !longish
            ? undefined
            : {
                display: "-webkit-box",
                WebkitLineClamp: clampLines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>
      {longish && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-sm font-medium text-accent hover:underline"
        >
          {open ? "Leer menos" : "Leer más"}
        </button>
      )}
    </div>
  );
}
