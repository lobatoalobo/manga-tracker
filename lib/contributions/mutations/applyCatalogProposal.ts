/**
 * Mutación `applyCatalogProposal` (Community Contributions, ADR-006). Aplica al catálogo
 * una propuesta ACEPTADA (NEW_WORK crea un Work; NEW_EDITION crea una PublisherEdition) y
 * rellena las refs de aplicación del ResolutionRecord. ORQUESTACIÓN pura sobre el Mutation
 * Framework: la operación indivisible (lock → gate → dispatch → build → dedup → create →
 * update RR) vive en el write-port (infra). No conoce Prisma. NO inicia otra mutación.
 * `ctx.correlationId` viaja al write-port y se persiste como
 * `ResolutionRecord.mutationCorrelationId` en la misma tx. La auditoría NO incluye
 * títulos/valores de claims.
 */
import { defineMutation, ValidationError } from "@/lib/mutations";
import {
  TARGET_KIND_NEW_EDITION,
  TARGET_KIND_NEW_VOLUME,
  TARGET_KIND_VOLUME,
  type ApplyReadPort,
  type ApplySeed,
  type ApplyWritePort,
} from "@/lib/domain/proposal/apply";

// Conteo genérico para el preview/policy (target-agnóstico): 1 create + 1 update.
const CREATED = {
  creates: 1, // Work | PublisherEdition
  updates: 1, // ResolutionRecord (applied refs + correlation)
  deletes: 0,
  entities: ["Work", "ResolutionRecord"] as const,
};
const RECOVERED = { creates: 0, updates: 0, deletes: 0 };

export const applyCatalogProposal = defineMutation<
  ApplySeed,
  ApplySeed,
  ApplyReadPort,
  ApplyWritePort
>({
  name: "applyCatalogProposal",
  definitionVersion: 1,
  kind: "CONTRIB_APPLY_PROPOSAL",
  policy: { maxAffected: 4 }, // 1 Work + 1 ResolutionRecord
  idempotency: (i) => ({ key: i.idempotencyKey, scope: "applyCatalogProposal" }),

  validate(_ctx, seed) {
    if (!Number.isInteger(seed.proposalId) || seed.proposalId <= 0)
      throw new ValidationError("proposalId inválido.");
  },

  async preview(_ctx, seed) {
    return {
      affected: CREATED,
      irreversible: true, // crea una entidad real del catálogo
      // summary SIN títulos/valores de claims (no filtrar a la auditoría). El target
      // no se conoce en preview (se lee bajo lock en el write-port) → texto genérico.
      summary: {
        domain: "applyCatalogProposal",
        human: `Aplica la propuesta ${seed.proposalId} al catálogo.`,
      },
      plan: seed,
    };
  },

  async execute(ctx, _input, plan) {
    if (!ctx.write) throw new Error("applyCatalogProposal.execute requiere write-port (tx).");
    const r = await ctx.write.apply(plan, ctx.correlationId);
    if (r.recovered) return { affected: RECOVERED };
    const isVolumeCorrection = r.targetKind === TARGET_KIND_VOLUME;
    const entities =
      r.targetKind === TARGET_KIND_NEW_EDITION
        ? (["PublisherEdition", "ResolutionRecord"] as const)
        : r.targetKind === TARGET_KIND_NEW_VOLUME || isVolumeCorrection
          ? (["Volume", "ResolutionRecord"] as const)
          : (["Work", "ResolutionRecord"] as const);
    // Mutation (corrección) actualiza la entidad; Creation la crea. `affected` es
    // best-effort: en un patch vacío el UPDATE del Volume no ocurre (updates real = 1).
    return isVolumeCorrection
      ? { affected: { creates: 0, updates: 2, deletes: 0, entities } }
      : { affected: { creates: 1, updates: 1, deletes: 0, entities } };
  },
});
