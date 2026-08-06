"use client";

import { Menu, CalendarDays, Plus } from "lucide-react";
import { TopbarActions } from "@/components/store-home/TopbarActions";
import { useOpenMenu } from "@/components/store-home/StoreShell";

/**
 * Encabezado de la pantalla Preventas: fila de acciones (buscador + campana + avatar) y, debajo, el título de la
 * sección con su ícono y el botón "Nueva preventa". El botón todavía no navega ni crea datos.
 */
export function PreordersHeader() {
  const onMenu = useOpenMenu();
  return (
    <header className="space-y-6">
      {/* Fila de acciones globales */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={onMenu} aria-label="Abrir menú" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden">
          <Menu size={20} aria-hidden />
        </button>
        <div className="min-w-0 flex-1" />
        <TopbarActions />
      </div>

      {/* Título + acción principal */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarDays size={26} strokeWidth={2.2} className="shrink-0 text-violet-600" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900">Preventas</h1>
            <p className="text-sm text-slate-500">Gestioná todas las preventas de tu tienda.</p>
          </div>
        </div>
        <button type="button" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700">
          <Plus size={18} aria-hidden /> Nueva preventa
        </button>
      </div>
    </header>
  );
}
