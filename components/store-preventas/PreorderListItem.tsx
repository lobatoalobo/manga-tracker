import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { CoverPlaceholder } from "@/components/store-home/CoverPlaceholder";
import { formatArsCents } from "@/lib/retail/format";
import type { CloseView, PreorderRow } from "@/lib/retail/preorders-dashboard";
import { STAGE_BAR } from "./preventas-view";
import { PreorderStatusBadge } from "./PreorderStatusBadge";

/** Collage de tapas parcialmente superpuestas (placeholder hasta que existan imágenes reales). */
function Collage({ n }: { n: number }) {
  if (n <= 0) return <CoverPlaceholder w={44} />;
  return (
    <div className="flex shrink-0 items-center">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -16, zIndex: n - i }}>
          <CoverPlaceholder w={44} className="ring-2 ring-white" />
        </div>
      ))}
    </div>
  );
}

/** Columna "Cierre": encabezado pequeño + fecha/hora o "Sin fecha"/"Completada". */
function CloseCol({ close }: { close: CloseView }) {
  return (
    <div className="leading-tight lg:w-28 lg:shrink-0">
      {close.label ? <div className="text-xs text-slate-400">{close.label}</div> : null}
      <div className={`text-sm font-semibold ${close.muted ? "text-slate-400" : "text-slate-900"}`}>{close.primary}</div>
      {close.secondary ? <div className="text-xs text-slate-500">{close.secondary}</div> : null}
      {close.tertiary ? <div className="text-xs text-slate-400">{close.tertiary}</div> : null}
    </div>
  );
}

/** Métrica en columna: encabezado pequeño arriba, valor destacado abajo. */
function Metric({ label, value, className = "" }: { label: string; value: string | number; className?: string }) {
  return (
    <div className={`leading-tight ${className}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

/** Una preventa como tarjeta horizontal amplia (una fila en desktop; se apila en mobile). */
export function PreorderListItem({ row, slug }: { row: PreorderRow; slug: string }) {
  const publishers = row.publishers.join(" · ");
  const extra = row.extraCount > 0 ? `+${row.extraCount} ${row.extraCount === 1 ? "editorial" : "editoriales"}` : "";
  const href =
    row.cta === "resumen"
      ? `/tiendas/${slug}/admin/preventas/${row.id}`
      : `/tiendas/${slug}/admin/preventas/${row.id}/estudio`;
  const ctaLabel = row.cta === "resumen" ? "Ver resumen" : "Abrir estudio";

  return (
    <article className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-5">
        {/* Identidad: barra de etapa + collage + título */}
        <div className="flex items-center gap-4 lg:min-w-0 lg:flex-1">
          <span className={`h-14 w-1.5 shrink-0 rounded-full ${STAGE_BAR[row.stage]}`} aria-hidden />
          <Collage n={row.covers} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold text-slate-900">{row.title}</h3>
              <PreorderStatusBadge stage={row.stage} />
            </div>
            {publishers ? <p className="mt-0.5 truncate text-sm text-slate-500">{publishers}</p> : null}
            {extra ? <p className="mt-0.5 text-xs text-slate-400">{extra}</p> : null}
          </div>
        </div>

        {/* Cierre + métricas + acciones */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 lg:gap-7">
          <CloseCol close={row.close} />
          <div className="grid grid-cols-3 gap-4 sm:flex sm:gap-6 lg:gap-7">
            <Metric label="Títulos" value={row.titulos} className="lg:w-16" />
            <Metric label="Reservas" value={row.reservas} className="lg:w-16" />
            <Metric label="Reservado" value={formatArsCents(row.reservadoCents)} className="lg:w-28" />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto lg:ml-0">
            <Link href={href} className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-center text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-50 sm:flex-none">
              {ctaLabel}
            </Link>
            <button type="button" aria-label="Más opciones" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100">
              <MoreVertical size={18} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
