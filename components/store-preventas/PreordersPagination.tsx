import { PAGINATION } from "./mock-preventas";

/** Pie de la lista: conteo a la izquierda; paginación (solo visual, sin lógica) a la derecha. */
export function PreordersPagination() {
  return (
    <div className="flex flex-col items-center justify-between gap-3 pt-1 sm:flex-row">
      <p className="text-sm text-slate-500">{PAGINATION.showing}</p>
      <div className="flex items-center gap-2">
        <button type="button" disabled className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-300">
          Anterior
        </button>
        <button type="button" aria-current="page" className="grid h-9 min-w-9 place-items-center rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white">
          1
        </button>
        <button type="button" disabled className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-300">
          Siguiente
        </button>
      </div>
    </div>
  );
}
