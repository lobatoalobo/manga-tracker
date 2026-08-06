"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { StoreSidebar } from "./StoreSidebar";
import type { NavKey } from "./mock-home";

/** Permite a cualquier encabezado (Home, Preventas, …) abrir el drawer del sidebar en mobile. */
const OpenMenuContext = createContext<() => void>(() => {});
export const useOpenMenu = () => useContext(OpenMenuContext);

/**
 * Shell compartido de las pantallas de tienda: sidebar oscuro fijo (drawer en mobile) + contenedor de contenido
 * claro con ancho máximo. Cada pantalla pasa su `active` (sección del sidebar) y su contenido como children.
 * El diseño (colores, ancho, padding) es idéntico al aprobado en el Home; acá vive una sola vez para no duplicarlo.
 */
export function StoreShell({ active, children }: { active: NavKey; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <OpenMenuContext.Provider value={() => setOpen(true)}>
      <div className="flex h-screen overflow-hidden bg-[#f6f7fb] text-slate-900">
        {/* Sidebar fijo (desktop) */}
        <aside className="hidden shrink-0 lg:block">
          <StoreSidebar active={active} />
        </aside>

        {/* Drawer (mobile) */}
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute left-0 top-0 h-full shadow-2xl">
              <StoreSidebar active={active} />
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="absolute right-3 top-5 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10">
                <X size={18} aria-hidden />
              </button>
            </div>
          </div>
        ) : null}

        {/* Contenido */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1440px] space-y-6 px-5 py-6 lg:px-8 lg:py-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </OpenMenuContext.Provider>
  );
}
