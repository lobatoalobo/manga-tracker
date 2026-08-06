/**
 * Placeholder de una tapa de tomo (aún no hay imágenes reales en el catálogo). Respeta la PROPORCIÓN real de un
 * tomo manga (~2:3). ÚNICO punto de reemplazo: el día que existan portadas, este componente muestra la imagen y
 * el resto del Home no cambia.
 */
export function CoverPlaceholder({ w = 54, label = "Cover", className = "" }: { w?: number; label?: string; className?: string }) {
  const h = Math.round(w * 1.48); // proporción tomo manga
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-slate-400 shadow-sm ${className}`}
      style={{ width: w, height: h }}
      aria-hidden
    >
      <span className="font-medium uppercase tracking-wide" style={{ fontSize: Math.max(8, Math.round(w * 0.16)) }}>{label}</span>
    </div>
  );
}
