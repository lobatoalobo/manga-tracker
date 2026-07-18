/**
 * Mutación `addProposalContribution` (Community Contributions, ADR-006).
 * ORQUESTACIÓN pura: reglas en el dominio (lib/domain/proposal/addContribution),
 * datos por puertos (impl en lib/infra/proposal/addContribution). No conoce Prisma.
 * Crea, atómicamente, una ProposalContribution + sus ProposalClaim(s) (≥1). Reusa el
 * Mutation Framework tal cual (ADR-002); no lo modifica.
 */
import { defineMutation } from "@/lib/mutations";
import {
  buildContributionSeed,
  validateInputShape,
  type AddContributionSeed,
  type AddContributionReadPort,
  type AddContributionWritePort,
  type AddProposalContributionInput,
} from "@/lib/domain/proposal/addContribution";

const affectedFor = (claimCount: number) => ({
  creates: 1 + claimCount, // 1 ProposalContribution + N ProposalClaim
  updates: 0,
  deletes: 0,
  entities: ["ProposalContribution", "ProposalClaim"] as const,
});

export const addProposalContribution = defineMutation<
  AddProposalContributionInput,
  AddContributionSeed,
  AddContributionReadPort,
  AddContributionWritePort
>({
  name: "addProposalContribution",
  definitionVersion: 1,
  kind: "CONTRIB_ADD_CONTRIBUTION",
  policy: { maxAffected: 51 }, // 1 contribución + hasta MAX_CLAIMS_PER_CONTRIBUTION
  idempotency: (i) => ({ key: i.createIdempotencyKey, scope: "addProposalContribution" }),

  // Barato (sin I/O): shape, ≥1 claim, enums, coherencia op↔value. Corre 2x (R1).
  validate(_ctx, input) {
    validateInputShape(input);
  },

  // Lee la propuesta (apertura + nivel) y arma el PLAN (semilla con claims normalizadas).
  async preview(ctx, input) {
    const seed = await buildContributionSeed(ctx.read, input, ctx.actor.id);
    return {
      affected: affectedFor(seed.claims.length),
      irreversible: false,
      summary: {
        domain: "addProposalContribution",
        human: `Agrega contribución con ${seed.claims.length} claim(s) a la propuesta ${seed.proposalId} (autor ${ctx.actor.id}).`,
      },
      plan: seed,
    };
  },

  // Aplica el plan: inserta contribución + claims en la tx (ids capturados en infra).
  async execute(ctx, _input, plan) {
    if (!ctx.write)
      throw new Error("addProposalContribution.execute requiere write-port (tx).");
    await ctx.write.insertContributionWithClaims(plan);
    return { affected: affectedFor(plan.claims.length) };
  },
});
