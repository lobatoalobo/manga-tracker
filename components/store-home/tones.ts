import type { Tone } from "./mock-home";

// Paletas PASTEL por tono (nunca saturado). Un tono = un rol de color en badges/iconos.
export const TONE_BADGE: Record<Tone, string> = {
  violet: "bg-violet-100 text-violet-600",
  amber: "bg-amber-100 text-amber-600",
  emerald: "bg-emerald-100 text-emerald-600",
  sky: "bg-sky-100 text-sky-600",
  slate: "bg-slate-100 text-slate-600",
  rose: "bg-rose-100 text-rose-600",
};

// Variante más suave (para badges numéricos de tareas).
export const TONE_SOFT: Record<Tone, string> = {
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  sky: "bg-sky-50 text-sky-600",
  slate: "bg-slate-100 text-slate-600",
  rose: "bg-rose-50 text-rose-600",
};
