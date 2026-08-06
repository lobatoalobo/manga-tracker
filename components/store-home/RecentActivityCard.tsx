import { ChevronRight } from "lucide-react";
import { ACTIVITY } from "./mock-home";
import { IconBadge } from "./IconBadge";

/** Card "Actividad reciente": timeline de eventos con ícono, texto y fecha. */
export function RecentActivityCard() {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">Actividad reciente</h2>
      <ul className="divide-y divide-slate-100">
        {ACTIVITY.map((a, i) => (
          <li key={i} className="flex items-center gap-3 py-3 first:pt-0">
            <IconBadge icon={a.icon} tone={a.tone} size={36} radius="rounded-lg" />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{a.text}</span>
            <span className="shrink-0 text-xs text-slate-400">{a.when}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-slate-100 pt-4 text-center">
        <a href="#" className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 transition-colors hover:text-violet-700">Ver toda la actividad <ChevronRight size={15} aria-hidden /></a>
      </div>
    </section>
  );
}
