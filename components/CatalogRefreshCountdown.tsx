"use client";

import { useEffect, useState } from "react";

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Contador (cliente) hacia la próxima actualización sugerida del catálogo.
 * Tickea cada 30s; si está vencida muestra hace cuánto, para que el admin sepa
 * que conviene correr el job (puede hacerlo antes cuando quiera).
 */
export default function CatalogRefreshCountdown({
  lastMs,
  dueMs,
}: {
  lastMs: number | null;
  dueMs: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (lastMs == null || dueMs == null)
    return (
      <span className="text-amber-300">
        · nunca actualizado — corré “Whakoom · TODAS”
      </span>
    );

  const remaining = dueMs - now;
  if (remaining <= 0)
    return (
      <span className="text-amber-300">
        · ⚠ actualización sugerida (vencida hace {fmt(now - dueMs)})
      </span>
    );
  return (
    <span className="text-muted">· próxima sugerida en {fmt(remaining)}</span>
  );
}
