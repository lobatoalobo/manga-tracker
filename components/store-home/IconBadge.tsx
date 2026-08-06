import type { LucideIcon } from "lucide-react";
import type { Tone } from "./mock-home";
import { TONE_BADGE } from "./tones";

/** Ícono en badge circular/redondeado con fondo pastel según tono. Reutilizado por KPIs, tareas y resumen. */
export function IconBadge({ icon: Icon, tone, size = 44, radius = "rounded-xl" }: { icon: LucideIcon; tone: Tone; size?: number; radius?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${radius} ${TONE_BADGE[tone]}`} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} aria-hidden />
    </span>
  );
}
