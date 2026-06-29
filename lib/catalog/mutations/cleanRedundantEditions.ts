import {
  planRedundantEditionCleanup,
  type CleanEditionsPlan,
  type CleanEditionsReadPort,
  type CleanEditionsWritePort,
} from "@/lib/domain/work/cleanupEditions";
import { defineMutation } from "@/lib/mutations";

/** Sin parámetros: la operación descubre el set sucio en runtime. */
export type CleanRedundantEditionsInput = Record<string, never>;

/**
 * Limpia ediciones redundantes (mismo Work, mismo normTitle): conserva la canónica
 * de cada grupo, borra el resto. Tercera mutación = SATURATION TEST del framework:
 * bulk, input vacío, plan = LISTA, y SIN idempotency key (la idempotencia es
 * inherente: re-correr no encuentra nada). El `maxDeletes` es la red de seguridad
 * real — si de golpe quisiera borrar cientos de ediciones, algo está mal → aborta.
 */
export const cleanRedundantEditions = defineMutation<
  CleanRedundantEditionsInput,
  CleanEditionsPlan,
  CleanEditionsReadPort,
  CleanEditionsWritePort
>({
  name: "cleanRedundantEditions",
  definitionVersion: 1,
  kind: "CLEANUP",
  policy: {
    maxDeletes: 200, // circuit-breaker bulk: un cleanup sano no borra cientos
    requiresConfirmation: "prod",
  },
  // SIN idempotency(): la idempotencia es inherente (re-correr re-detecta y no halla nada).

  async preview(ctx) {
    const groups = await ctx.read.loadRedundantGroups();
    const plan = planRedundantEditionCleanup(groups);
    const grupos = new Set(plan.map((d) => d.keptId)).size;
    const human = plan.length
      ? `Borra ${plan.length} edición(es) redundante(s) en ${grupos} grupo(s); ` +
        `conserva la canónica de cada uno.`
      : "No hay ediciones redundantes para limpiar.";
    return {
      affected: { creates: 0, updates: 0, deletes: plan.length, entities: ["PublisherEdition"] },
      irreversible: true,
      summary: { domain: "cleanRedundantEditions", human },
      plan,
    };
  },

  async execute(ctx, _input, plan) {
    if (!ctx.write) throw new Error("cleanRedundantEditions.execute requiere write-port (tx)");
    const deleted = await ctx.write.deleteEditions(plan.map((d) => d.id));
    return { affected: { creates: 0, updates: 0, deletes: deleted, entities: ["PublisherEdition"] } };
  },
});
