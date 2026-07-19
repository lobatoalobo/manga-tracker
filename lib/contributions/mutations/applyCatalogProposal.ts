/**
 * Mutación `applyCatalogProposal` (Community Contributions, ADR-006) — vertical
 * NEW_WORK. Aplica al catálogo una propuesta ACEPTADA: crea un Work y rellena las
 * refs de aplicación del ResolutionRecord. ORQUESTACIÓN pura sobre el Mutation
 * Framework: la operación indivisible (lock → gate → build → dedup → create Work →
 * update RR) vive en el write-port (infra). No conoce Prisma. NO inicia otra mutación.
 * `ctx.correlationId` viaja al write-port y se persiste como
 * `ResolutionRecord.mutationCorrelationId` en la misma tx. La auditoría NO incluye
 * títulos/valores de claims.
 */
import { defineMutation, ValidationError } from "@/lib/mutations";
import {
  type ApplyReadPort,
  type ApplySeed,
  type ApplyWritePort,
} from "@/lib/domain/proposal/apply";

const CREATED = {
  creates: 1, // Work
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
      irreversible: true, // crea un Work real
      // summary SIN títulos/valores de claims (no filtrar a la auditoría).
      summary: {
        domain: "applyCatalogProposal",
        human: `Aplica la propuesta ${seed.proposalId} al catálogo (NEW_WORK).`,
      },
      plan: seed,
    };
  },

  async execute(ctx, _input, plan) {
    if (!ctx.write) throw new Error("applyCatalogProposal.execute requiere write-port (tx).");
    const r = await ctx.write.apply(plan, ctx.correlationId);
    return { affected: r.recovered ? RECOVERED : CREATED };
  },
});
