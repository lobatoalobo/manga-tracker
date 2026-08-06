import { STORE_STAGE_LABEL, type StoreStage } from "@/lib/domain/retail/pipeline-stage";
import { STAGE_BADGE } from "./preventas-view";

/** Pill de etapa de una preventa (texto cotidiano en mayúsculas), con color pastel según la etapa derivada. */
export function PreorderStatusBadge({ stage }: { stage: StoreStage }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STAGE_BADGE[stage]}`}>
      {STORE_STAGE_LABEL[stage]}
    </span>
  );
}
