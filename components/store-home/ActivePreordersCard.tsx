import { ChevronRight, MoreVertical, BookOpen, Users, DollarSign, type LucideIcon } from "lucide-react";
import { ACTIVE_PREORDERS, type Preorder } from "./mock-home";
import { CoverPlaceholder } from "./CoverPlaceholder";

function Collage({ n }: { n: number }) {
  return (
    <div className="flex shrink-0 items-center">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -16, zIndex: n - i }}>
          <CoverPlaceholder w={46} className="ring-2 ring-white" />
        </div>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: string | number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Icon size={18} className="text-slate-400" aria-hidden />
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900">{value}</span>
        <span className="block text-xs text-slate-400">{label}</span>
      </span>
    </span>
  );
}

function Row({ p, accent }: { p: Preorder; accent: string }) {
  return (
    <div className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
      <span className={`h-14 w-1 shrink-0 rounded-full ${accent}`} aria-hidden />
      <Collage n={p.covers} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold text-slate-900">{p.title}</h3>
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-emerald-700">{p.estado}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">{p.cierre}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-7 gap-y-2">
          <Stat icon={BookOpen} value={p.titulos} label="Títulos" />
          <Stat icon={Users} value={p.reservas} label="Reservas" />
          <Stat icon={DollarSign} value={p.total} label="Total reservado" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-50">Ver detalle</button>
        <button type="button" aria-label="Más opciones" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100"><MoreVertical size={18} aria-hidden /></button>
      </div>
    </div>
  );
}

/** Card "Preventas activas": dos preventas con collage de tapas, estado, cierre, stats y acciones. */
export function ActivePreordersCard() {
  const accents = ["bg-violet-500", "bg-amber-400"];
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Preventas activas</h2>
        <a href="#" className="flex items-center gap-1 text-sm font-medium text-violet-600 transition-colors hover:text-violet-700">Ver todas <ChevronRight size={15} aria-hidden /></a>
      </div>
      <div className="divide-y divide-slate-100">
        {ACTIVE_PREORDERS.map((p, i) => <Row key={p.title} p={p} accent={accents[i % accents.length]} />)}
      </div>
    </section>
  );
}
