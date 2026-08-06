import { Sparkles } from "lucide-react";
import { KPIS, FOOTER } from "./mock-home";
import { StoreShell } from "./StoreShell";
import { TopHeader } from "./TopHeader";
import { KpiCard } from "./KpiCard";
import { ActivePreordersCard } from "./ActivePreordersCard";
import { UpcomingClosingCard } from "./UpcomingClosingCard";
import { PendingTasksCard } from "./PendingTasksCard";
import { RecentActivityCard } from "./RecentActivityCard";
import { MonthlySummaryCard } from "./MonthlySummaryCard";

/** Home de la tienda (SaaS): shell compartido con sidebar + contenido en cards. Solo estructura visual. */
export function StoreHome() {
  return (
    <StoreShell active="inicio">
      <TopHeader />

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
    </StoreShell>
  );
}
