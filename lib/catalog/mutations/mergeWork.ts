import {
  buildMergePlan,
  mergeSafetyViolation,
  type MergePlan,
  type MergeReadPort,
  type MergeWritePort,
} from "@/lib/domain/work/merge";
import { defineMutation, ValidationError } from "@/lib/mutations";

export interface MergeWorkInput {
  sourceId: number;
  targetId: number;
}

const affected = (moved: number, patch: object) => ({
  creates: 0,
  updates: moved + Object.keys(patch).length,
  deletes: 1,
  entities: ["Work", "PublisherEdition"] as const,
});

/**
 * Fusiona dos Works que son la MISMA serie (la operación más peligrosa: borra un
 * Work y re-clava data de usuario). ORQUESTACIÓN pura: las reglas viven en el
 * dominio (lib/domain/work/merge) y los datos en los puertos (impl en
 * lib/infra/work/merge). Este archivo no conoce Prisma. Ver ADR-002.
 */
export const mergeWork = defineMutation<MergeWorkInput, MergePlan, MergeReadPort, MergeWritePort>({
  name: "mergeWork",
  definitionVersion: 1,
  kind: "MERGE",
  policy: {
    maxDeletes: 1, // un merge borra EXACTAMENTE un Work
    maxAffected: 100,
    requiresConfirmation: "prod",
    requiresReview: true,
  },
  idempotency: (i) => ({ key: `merge-${i.sourceId}-${i.targetId}` }), // direccional, permanente

  async validate(ctx, input) {
    const [src, tgt] = await Promise.all([
      ctx.read.loadIdentity(input.sourceId),
      ctx.read.loadIdentity(input.targetId),
    ]);
    if (!src) throw new ValidationError(`Work source ${input.sourceId} no existe`);
    if (!tgt) throw new ValidationError(`Work target ${input.targetId} no existe`);
    const violation = mergeSafetyViolation(input.sourceId, input.targetId, src, tgt);
    if (violation) throw new ValidationError(violation);
  },

  async preview(ctx, input) {
    const [src, tgt] = await Promise.all([
      ctx.read.loadRow(input.sourceId),
      ctx.read.loadRow(input.targetId),
    ]);
    if (!src || !tgt) throw new ValidationError("source o target no existe");
    const plan = buildMergePlan(input.sourceId, input.targetId, src, tgt);
    const editions = await ctx.read.countEditions(input.sourceId);
    const patchFields = Object.keys(plan.patch);
    const human = [
      `Fusiona work ${src.id} «${src.title}» → ${tgt.id} «${tgt.title}».`,
      `Mueve ${editions} edición(es); borra el work source.`,
      patchFields.length ? `Backfill al target: ${patchFields.join(", ")}.` : "Sin backfill.",
      `Clave de dominio final: ${plan.finalKey}.`,
    ].join(" ");
    return {
      affected: affected(editions, plan.patch),
      irreversible: true,
      summary: { domain: "mergeWork", human },
      plan,
    };
  },

  async execute(ctx, input, plan) {
    if (!ctx.write) throw new Error("mergeWork.execute requiere write-port (tx)");
    // Lock pesimista de ambos works: serializa merges sobre los mismos ids.
    await ctx.write.lockWorks([input.sourceId, input.targetId]);
    const moved = await ctx.write.applyPlan(plan);
    return { affected: affected(moved, plan.patch) };
  },
});
