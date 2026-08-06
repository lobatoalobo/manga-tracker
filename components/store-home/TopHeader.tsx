import { Search, Bell, Menu } from "lucide-react";
import { GREETING } from "./mock-home";

/** Encabezado del contenido: saludo a la izquierda; buscador + campana + avatar a la derecha. */
export function TopHeader({ onMenu }: { onMenu?: () => void }) {
  return (
    <header className="flex items-center gap-4">
      <button type="button" onClick={onMenu} aria-label="Abrir menú" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden">
        <Menu size={20} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold text-slate-900">{GREETING.hello}</h1>
        <p className="truncate text-sm text-slate-500">{GREETING.sub}</p>
      </div>

      <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-400 shadow-sm md:flex md:w-72 lg:w-80">
        <Search size={18} aria-hidden />
        <input
          type="text"
          placeholder="Buscar en Nakama..."
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
        <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">⌘K</kbd>
      </div>

      <button type="button" aria-label="Notificaciones" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm">
        <Bell size={19} aria-hidden />
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-violet-600 px-1 text-[10px] font-semibold text-white">3</span>
      </button>

      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-600 text-sm font-semibold text-white">A</span>
    </header>
  );
}
