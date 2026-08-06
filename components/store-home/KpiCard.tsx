import type { Kpi } from "./mock-home";
import { IconBadge } from "./IconBadge";

/** Card KPI de la fila superior: ícono pastel + número grande + título + subtexto. */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <IconBadge icon={kpi.icon} tone={kpi.tone} size={48} />
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-tight text-slate-900">{kpi.value}</div>
        <div className="truncate text-sm font-medium text-slate-600">{kpi.title}</div>
        <div className="truncate text-xs text-slate-400">{kpi.sub}</div>
      </div>
    </div>
  );
}
