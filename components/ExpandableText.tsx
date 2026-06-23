"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Texto largo (sinopsis) colapsado con "Leer más" / "Leer menos". El botón SOLO
 * aparece si el texto realmente se trunca (lo medimos en el DOM: scrollHeight >
 * clientHeight con el clamp puesto), no por una heurística de largo. Así no queda
 * un "Leer más" que no hace nada cuando la sinopsis entra justo. Re-mide al
 * cambiar el ancho (ResizeObserver), porque la cantidad de líneas depende del ancho.
 */
export default function ExpandableText({
  text,
  clampLines = 6,
  className = "mt-6",
}: {
  text: string;
  clampLines?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Solo medimos en estado colapsado (con el clamp aplicado). Expandido el
      // scrollHeight == clientHeight y daría un falso "no trunca".
      if (openRef.current) return;
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, clampLines]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className="whitespace-pre-wrap text-sm leading-relaxed text-muted"
        style={
          open
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
      {overflows && (
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
