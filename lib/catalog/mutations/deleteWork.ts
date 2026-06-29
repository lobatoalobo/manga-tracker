import {
  buildDeleteWorkPlan,
  deleteWorkWarnings,
  type DeleteWorkInput,
  type DeleteWorkPlan,
  type DeleteWorkReadPort,
  type DeleteWorkWritePort,
} from "@/lib/domain/work/delete";
import { defineMutation, ValidationError } from "@/lib/mutations";

const ENTITIES = [
  "Work", "PublisherEdition", "Manga", "WishlistItem", "UserNote", "Activity",
  "Notification", "PurchaseItem", "IvreaRelease",
] as const;

/**
 * Borra por completo un Work (hard delete IRREVERSIBLE: ediciones + toda la data
 * de usuario de su clave de dominio). Second critical-path mutation. Reglas en el
 * dominio (lib/domain/work/delete), datos en los puertos (lib/infra/work/delete);
 * este archivo no conoce Prisma.
 *
 * Policy MÁS estricta que mergeWork: confirmación SIEMPRE (no solo prod), porque no
 * hay "deshacer" — el undo real es el restore PITR de Neon.
 */
export const deleteWork = defineMutation<
  DeleteWorkInput,
  DeleteWorkPlan,
  DeleteWorkReadPort,
  DeleteWorkWritePort
>({
  name: "deleteWork",
  definitionVersion: 1,
  kind: "DELETE",
  policy: {
    maxDeletes: 1, // gobierna el borrado de Works (1); las dependencias son cascade
    requiresConfirmation: "always",
    requiresReview: true,
  },
  idempotency: (i) => ({ key: `delete-work-${i.workId}` }),

  async validate(ctx, input) {
    const work = await ctx.read.loadIdentity(input.workId);
    if (!work) throw new ValidationError(`Work ${input.workId} no existe`);
  },

  async preview(ctx, input) {
    const work = await ctx.read.loadIdentity(input.workId);
    if (!work) throw new ValidationError(`Work ${input.workId} no existe`);
    const plan = buildDeleteWorkPlan(work);
    const impact = await ctx.read.impact(plan);
    const human =
      `BORRA work ${work.id} «${work.title}» (clave de dominio ${plan.domainKey}). ` +
      `Elimina ${impact.editions} edición(es), ${impact.collection} en colección y ` +
      `${impact.wishlist} en deseados. Irreversible.`;
    return {
      affected: { creates: 0, updates: 0, deletes: 1, entities: [...ENTITIES] },
      irreversible: true,
      summary: { domain: "deleteWork", human },
      warnings: deleteWorkWarnings(impact),
      plan,
    };
  },

  async execute(ctx, input, plan) {
    if (!ctx.write) throw new Error("deleteWork.execute requiere write-port (tx)");
    await ctx.write.lockWork(input.workId);
    await ctx.write.applyDelete(plan);
    return { affected: { creates: 0, updates: 0, deletes: 1, entities: [...ENTITIES] } };
  },
});
