import { ChevronDown } from "lucide-react";
import { STORE } from "./mock-home";

/** Card de la tienda (pie del sidebar): avatar + nombre + plan. */
export function StoreInfoCard() {
  return (
    <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2.5 text-left transition-colors hover:bg-white/10">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-semibold text-white">{STORE.initial}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{STORE.name}</span>
        <span className="block truncate text-xs text-violet-300">{STORE.plan}</span>
      </span>
      <ChevronDown size={16} className="shrink-0 text-slate-500" aria-hidden />
    </button>
  );
}
