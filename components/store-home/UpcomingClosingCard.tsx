import { ChevronRight, MoreVertical, CalendarClock, BookOpen, Users, DollarSign, type LucideIcon } from "lucide-react";
import { UPCOMING } from "./mock-home";
import { CoverPlaceholder } from "./CoverPlaceholder";

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: string | number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Icon size={18} className="text-slate-400" aria-hidden />
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900">{value}</span>
        <span className="block text-xs text-slate-400">{label}</span>
      </span>
    </span>
  );
}

/** Card "Próximas a cerrar": una sola preventa que cierra pronto. */
export function UpcomingClosingCard() {
  const p = UPCOMING;
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <CalendarClock size={18} className="text-amber-500" aria-hidden />
        <h2 className="text-lg font-semibold text-slate-900">Próximas a cerrar</h2>
        <a href="#" className="ml-auto flex items-center gap-1 text-sm font-medium text-violet-600 transition-colors hover:text-violet-700">Ver todas <ChevronRight size={15} aria-hidden /></a>
      </div>
      <div className="flex items-center gap-4">
        <CoverPlaceholder w={46} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-900">{p.title}</h3>
          <p className="mt-0.5 truncate text-sm text-slate-500">{p.cierre}</p>
        </div>
        <div className="hidden flex-wrap items-center gap-x-7 gap-y-2 sm:flex">
          <Stat icon={BookOpen} value={p.titulos} label="Títulos" />
          <Stat icon={Users} value={p.reservas} label="Reservas" />
          <Stat icon={DollarSign} value={p.total} label="Total reservado" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-50">Ver detalle</button>
          <button type="button" aria-label="Más opciones" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100"><MoreVertical size={18} aria-hidden /></button>
        </div>
      </div>
    </section>
  );
}
