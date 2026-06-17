"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Buscador del catálogo local en tiempo real: filtra a medida que escribís
 * (debounce 250ms) actualizando la URL, que re-renderiza la grilla del servidor.
 */
export default function CatalogSearch({
  tab,
  initialQ,
}: {
  tab: string;
  initialQ: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [pending, start] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      const params = new URLSearchParams();
      params.set("tab", tab);
      if (q.trim()) params.set("q", q.trim());
      start(() => router.replace(`/catalogo?${params.toString()}`, { scroll: false }));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative mb-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar obra…"
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />
      {pending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          …
        </span>
      )}
    </div>
  );
}
