import { Search, ChevronDown, List, LayoutGrid } from "lucide-react";
import { STAGE_FILTER, SORT_FILTER } from "./mock-preventas";

/** Solo un select visual (no filtra todavía). */
function FilterSelect({ label }: { label: string }) {
  return (
    <button type="button" className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50">
      <span className="truncate">{label}</span>
      <ChevronDown size={16} className="shrink-0 text-slate-400" aria-hidden />
    </button>
  );
}

/**
 * Barra de búsqueda + filtros de la lista de preventas. Todo es visual (mock): el buscador no filtra, los selects
 * no ordenan y el toggle lista/grilla no cambia el layout.
 */
export function PreordersToolbar() {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {/* Buscar */}
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-400 shadow-sm">
        <Search size={18} aria-hidden />
        <input
          type="text"
          placeholder="Buscar preventas..."
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
      </div>

      {/* Filtros + vista */}
      <div className="flex items-center gap-3">
        <FilterSelect label={STAGE_FILTER} />
        <FilterSelect label={SORT_FILTER} />
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" aria-label="Ver como lista" aria-pressed className="grid h-8 w-8 place-items-center rounded-lg bg-violet-600 text-white">
            <List size={17} aria-hidden />
          </button>
          <button type="button" aria-label="Ver como grilla" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100">
            <LayoutGrid size={17} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
