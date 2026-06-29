import { Prisma, type PrismaClient } from "@prisma/client";
import { romajiKey, tightTitleKey } from "@/lib/catalog";
import {
  applyMergeInTx,
  buildMergePlan,
  mergeWorkSelect,
  type MergePlan,
} from "@/lib/mergeWorks";
import { defineMutation, ValidationError } from "@/lib/mutations";

export interface MergeWorkInput {
  sourceId: number;
  targetId: number;
}

/** Identidad mínima para decidir si dos Works son la MISMA serie. */
export interface SeriesIdentity {
  title: string;
  anilistId: number | null;
  muId: string | null;
  mdId: string | null;
  originalTitle: string | null;
}
const identitySelect = {
  id: true, title: true, anilistId: true, muId: true, mdId: true, originalTitle: true,
} satisfies Prisma.WorkSelect;

/**
 * Invariante de dominio del merge — PURO y testeable. Evita fusionar series
 * distintas (la causa raíz de los over-merge: el matcher pegaba el muId de una
 * serie base a un spin-off). Es conservador: ante la duda, NO fusiona.
 */
export function sameSeries(a: SeriesIdentity, b: SeriesIdentity): boolean {
  // Rechazo fuerte: dos identidades externas confirmadas y DISTINTAS = no es dup.
  if (a.anilistId && b.anilistId && a.anilistId !== b.anilistId) return false;
  if (a.muId && b.muId && a.muId !== b.muId) return false;
  if (a.mdId && b.mdId && a.mdId !== b.mdId) return false;
  // Señal positiva: misma identidad externa…
  if (a.anilistId && a.anilistId === b.anilistId) return true;
  if (a.muId && a.muId === b.muId) return true;
  if (a.mdId && a.mdId === b.mdId) return true;
  // …o mismo título estricto / mismo romaji base (conserva "+": Citrus ≠ Citrus+).
  if (tightTitleKey(a.title) === tightTitleKey(b.title)) return true;
  if (a.originalTitle && b.originalTitle && romajiKey(a.originalTitle) === romajiKey(b.originalTitle))
    return true;
  return false;
}

const affected = (moved: number, patch: object) => ({
  creates: 0,
  updates: moved + Object.keys(patch).length,
  deletes: 1,
  entities: ["Work", "PublisherEdition"] as const,
});

/**
 * Fusiona dos Works que son la MISMA serie (la operación más peligrosa del
 * sistema: borra un Work y re-clava data de usuario). Primera mutación real sobre
 * el framework: valida el invariante "misma serie", preview arma el plan, execute
 * lockea ambos works y lo aplica. Ver lib/mergeWorks (lógica) y
 * docs/mutation-framework.md.
 */
export const mergeWork = defineMutation<MergeWorkInput, MergePlan>({
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
    if (input.sourceId === input.targetId)
      throw new ValidationError("source y target son el mismo Work");
    const db = ctx.read as PrismaClient;
    const [src, tgt] = await Promise.all([
      db.work.findUnique({ where: { id: input.sourceId }, select: identitySelect }),
      db.work.findUnique({ where: { id: input.targetId }, select: identitySelect }),
    ]);
    if (!src) throw new ValidationError(`Work source ${input.sourceId} no existe`);
    if (!tgt) throw new ValidationError(`Work target ${input.targetId} no existe`);
    if (!sameSeries(src, tgt))
      throw new ValidationError(
        `works ${input.sourceId}/${input.targetId} no parecen la misma serie`,
      );
  },

  async preview(ctx, input) {
    const db = ctx.read as PrismaClient;
    const [src, tgt] = await Promise.all([
      db.work.findUnique({ where: { id: input.sourceId }, select: mergeWorkSelect }),
      db.work.findUnique({ where: { id: input.targetId }, select: mergeWorkSelect }),
    ]);
    if (!src || !tgt) throw new ValidationError("source o target no existe");
    const plan = buildMergePlan(input.sourceId, input.targetId, src, tgt);
    const editions = await db.publisherEdition.count({ where: { workId: input.sourceId } });
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
    if (!ctx.write) throw new Error("mergeWork.execute requiere write handle (tx)");
    // Lock pesimista de ambos works: serializa merges sobre los mismos ids.
    await ctx.write.lock([
      { table: "Work", id: input.sourceId },
      { table: "Work", id: input.targetId },
    ]);
    const moved = await applyMergeInTx(ctx.write.client as Prisma.TransactionClient, plan);
    return { affected: affected(moved, plan.patch) };
  },
});
