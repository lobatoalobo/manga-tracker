import { STATUS_BADGE, type PreorderStatus } from "./mock-preventas";

/** Pill de estado de una preventa, con color pastel según el estado. */
export function PreorderStatusBadge({ estado }: { estado: PreorderStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_BADGE[estado]}`}>
      {estado}
    </span>
  );
}
