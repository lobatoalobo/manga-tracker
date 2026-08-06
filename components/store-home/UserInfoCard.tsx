import { ChevronDown } from "lucide-react";
import { USER } from "./mock-home";

/** Card del usuario (pie del sidebar): avatar con punto de conexión + nombre + rol. */
export function UserInfoCard() {
  return (
    <button type="button" className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-white/5">
      <span className="relative shrink-0">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-white">{USER.initial}</span>
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0f1016] bg-emerald-400" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{USER.name}</span>
        <span className="block truncate text-xs text-slate-400">{USER.role}</span>
      </span>
      <ChevronDown size={16} className="shrink-0 text-slate-500" aria-hidden />
    </button>
  );
}
