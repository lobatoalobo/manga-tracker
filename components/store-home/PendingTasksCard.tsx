import { ChevronRight } from "lucide-react";
import { TASKS } from "./mock-home";
import { IconBadge } from "./IconBadge";
import { TONE_SOFT } from "./tones";

/** Card "Tareas pendientes": lista de acciones con ícono, texto y badge numérico. */
export function PendingTasksCard() {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Tareas pendientes</h2>
        <a href="#" className="flex items-center gap-1 text-sm font-medium text-violet-600 transition-colors hover:text-violet-700">Ver todas <ChevronRight size={15} aria-hidden /></a>
      </div>
      <ul className="space-y-1">
        {TASKS.map((t, i) => (
          <li key={i}>
            <a href="#" className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-slate-50">
              <IconBadge icon={t.icon} tone={t.tone} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{t.title}</span>
                <span className="block truncate text-xs text-slate-400">{t.sub}</span>
              </span>
              <span className={`grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-xs font-semibold ${TONE_SOFT[t.tone]}`}>{t.badge}</span>
              <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
