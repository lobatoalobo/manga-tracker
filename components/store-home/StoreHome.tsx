"use client";

import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { KPIS, FOOTER } from "./mock-home";
import { StoreSidebar } from "./StoreSidebar";
import { TopHeader } from "./TopHeader";
import { KpiCard } from "./KpiCard";
import { ActivePreordersCard } from "./ActivePreordersCard";
import { UpcomingClosingCard } from "./UpcomingClosingCard";
import { PendingTasksCard } from "./PendingTasksCard";
import { RecentActivityCard } from "./RecentActivityCard";
import { MonthlySummaryCard } from "./MonthlySummaryCard";

/** Home de la tienda (SaaS): shell con sidebar fijo (drawer en mobile) + contenido en cards. Solo estructura visual. */
export function StoreHome() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f7fb] text-slate-900">
      {/* Sidebar fijo (desktop) */}
      <aside className="hidden shrink-0 lg:block">
        <StoreSidebar />
      </aside>

      {/* Drawer (mobile) */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-0 h-full shadow-2xl">
            <StoreSidebar />
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
            <TopHeader onMenu={() => setOpen(true)} />

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              {KPIS.map((k, i) => <KpiCard key={i} kpi={k} />)}
            </div>

            {/* Fila principal: 65% / 35% */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <ActivePreordersCard />
                <UpcomingClosingCard />
              </div>
              <div className="lg:col-span-1">
                <PendingTasksCard />
              </div>
            </div>

            {/* Fila inferior: 50% / 50% */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RecentActivityCard />
              <MonthlySummaryCard />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/70 bg-white/60 px-6 py-4 text-center text-sm text-slate-500">
              <Sparkles size={16} className="shrink-0 text-violet-500" aria-hidden />
              <span>{FOOTER}</span>
              <span aria-hidden>💜</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
