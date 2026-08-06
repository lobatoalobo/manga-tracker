"use client";

import { Menu } from "lucide-react";
import { GREETING } from "./mock-home";
import { TopbarActions } from "./TopbarActions";
import { useOpenMenu } from "./StoreShell";

/** Encabezado del Home: saludo a la izquierda; buscador + campana + avatar a la derecha. */
export function TopHeader() {
  const onMenu = useOpenMenu();
  return (
    <header className="flex items-center gap-4">
      <button type="button" onClick={onMenu} aria-label="Abrir menú" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden">
        <Menu size={20} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold text-slate-900">{GREETING.hello}</h1>
        <p className="truncate text-sm text-slate-500">{GREETING.sub}</p>
      </div>

      <TopbarActions />
    </header>
  );
}
