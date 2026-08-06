"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, List, LayoutGrid } from "lucide-react";
import { STAGE_FILTER_OPTIONS, SORT_OPTIONS } from "./preventas-view";

/**
 * Barra de búsqueda + filtros de la lista de preventas. Los controles son REALES: escriben en la URL
 * (searchParams) y el server component recarga con datos filtrados/ordenados. El toggle grilla queda deshabilitado
 * (la vista grilla no está diseñada todavía; no se muestra un control que no funcione).
 */
export function PreordersToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete("page"); // cualquier cambio de filtro vuelve a la página 1
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {/* Buscar (submit con Enter) */}
      <form
        onSubmit={(e) => { e.preventDefault(); apply({ q }); }}
        className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-400 shadow-sm focus-within:border-violet-300"
      >
        <Search size={18} aria-hidden />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar preventas..."
          aria-label="Buscar preventas"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
      </form>

      {/* Filtros + vista */}
      <div className="flex items-center gap-3">
        <select
          value={params.get("stage") ?? ""}
          onChange={(e) => apply({ stage: e.target.value })}
          aria-label="Filtrar por etapa"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 shadow-sm outline-none transition-colors hover:bg-slate-50"
        >
          {STAGE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={params.get("sort") ?? "recientes"}
          onChange={(e) => apply({ sort: e.target.value })}
          aria-label="Ordenar"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 shadow-sm outline-none transition-colors hover:bg-slate-50"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Ordenar: ${o.label}`}</option>)}
        </select>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <span aria-label="Ver como lista" aria-current="true" className="grid h-8 w-8 place-items-center rounded-lg bg-violet-600 text-white">
            <List size={17} aria-hidden />
          </span>
          <button type="button" aria-label="Ver como grilla (próximamente)" disabled title="Próximamente" className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-lg text-slate-300">
            <LayoutGrid size={17} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
