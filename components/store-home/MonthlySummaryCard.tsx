import { ChevronDown, ArrowUpRight } from "lucide-react";
import { MONTH } from "./mock-home";
import { IconBadge } from "./IconBadge";

/** Card "Resumen del mes": selector de mes + cuatro KPI con delta vs. mes anterior. */
export function MonthlySummaryCard() {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Resumen del mes</h2>
        <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50">
          {MONTH.label} <ChevronDown size={14} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {MONTH.kpis.map((k, i) => (
          <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <IconBadge icon={k.icon} tone={k.tone} size={36} radius="rounded-lg" />
            <div className="mt-3 truncate text-xs font-medium text-slate-500">{k.title}</div>
            <div className="mt-0.5 text-xl font-semibold text-slate-900">{k.value}</div>
            <div className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-600">
              <ArrowUpRight size={13} aria-hidden /> {k.delta}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
