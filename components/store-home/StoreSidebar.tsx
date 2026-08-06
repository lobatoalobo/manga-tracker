"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BookMarked, ChevronLeft } from "lucide-react";
import { NAV, type NavKey } from "./mock-home";
import { StoreInfoCard } from "./StoreInfoCard";
import { UserInfoCard } from "./UserInfoCard";

const ACTIVE_CLS =
  "flex items-center gap-3 rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-600/25";
const IDLE_CLS =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100";

/**
 * Sidebar fijo (≈260px), gris muy oscuro: logo + navegación + card de tienda + card de usuario.
 * `active` marca la sección actual; los ítems con `href` navegan (conservando el slug real de la ruta),
 * el resto son placeholders sin destino todavía.
 */
export function StoreSidebar({ active }: { active: NavKey }) {
  const params = useParams();
  const raw = params?.slug;
  const slug = Array.isArray(raw) ? raw[0] : raw ?? "";

  return (
    <div className="flex h-full w-[260px] flex-col bg-[#0f1016] text-slate-300">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 pb-2 pt-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/20">
          <BookMarked size={20} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-base font-semibold text-white">Nakama</span>
          <span className="block text-xs text-slate-400">Store</span>
        </span>
      </div>

      {/* Navegación */}
      <nav className="mt-6 flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map(({ key, label, icon: Icon, href }) => {
          const isActive = key === active;
          const cls = isActive ? ACTIVE_CLS : IDLE_CLS;
          if (href && slug) {
            return (
              <Link key={key} href={href(slug)} aria-current={isActive ? "page" : undefined} className={cls}>
                <Icon size={18} strokeWidth={2} aria-hidden />
                {label}
              </Link>
            );
          }
          // Placeholder: sección aún no implementada, no navega.
          return (
            <button key={key} type="button" aria-disabled className={`${cls} w-full text-left`}>
              <Icon size={18} strokeWidth={2} aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Pie: tienda + usuario + contraer */}
      <div className="space-y-2 border-t border-white/5 px-3 py-4">
        <StoreInfoCard />
        <UserInfoCard />
        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300">
          <ChevronLeft size={14} aria-hidden /> Contraer menú
        </button>
      </div>
    </div>
  );
}
