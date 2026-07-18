/**
 * Mutación `createCatalogProposal` (Community Contributions, ADR-006). ORQUESTACIÓN
 * pura: las reglas viven en el dominio (lib/domain/proposal/create) y los datos en
 * los puertos (impl en lib/infra/proposal/create). No conoce Prisma. Ver ADR-002 /
 * docs/mutation-framework.md. Crea, atómicamente, un CatalogProposal + su
 * ProposalContribution originadora (nunca una propuesta con 0 contribuciones).
 */
import { defineMutation } from "@/lib/mutations";
import {
  resolveSeed,
  validateStructure,
  type CatalogProposalSeed,
  type CreateCatalogProposalInput,
  type CreateProposalReadPort,
  type CreateProposalWritePort,
} from "@/lib/domain/proposal/create";

const AFFECTED = {
  creates: 2, // CatalogProposal + ProposalContribution originadora
  updates: 0,
  deletes: 0,
  entities: ["CatalogProposal", "ProposalContribution"] as const,
};

export const createCatalogProposal = defineMutation<
  CreateCatalogProposalInput,
  CatalogProposalSeed,
  CreateProposalReadPort,
  CreateProposalWritePort
>({
  name: "createCatalogProposal",
  definitionVersion: 1,
  kind: "CONTRIB_CREATE_PROPOSAL",
  policy: { maxCreates: 2, maxAffected: 2 },
  idempotency: (i) => ({ key: i.createIdempotencyKey, scope: "createCatalogProposal" }),

  // Barato (sin I/O): estructura + matriz family×targetKind. Corre 2x (incluye R1).
  validate(_ctx, input) {
    validateStructure(input);
  },

  // Deriva contentClass + valida existencia de refs; arma el PLAN (semilla).
  async preview(ctx, input) {
    const seed = await resolveSeed(ctx.read, input, ctx.actor.id);
    const human =
      `Crea propuesta ${seed.family}/${seed.targetKind} (${seed.contentClass}) ` +
      `+ contribución originadora de ${ctx.actor.id}.`;
    return {
      affected: AFFECTED,
      irreversible: false,
      summary: { domain: "createCatalogProposal", human },
      plan: seed,
    };
  },

  // Aplica el plan: inserta propuesta + originadora en la tx (ids capturados en infra).
  async execute(ctx, _input, plan) {
    if (!ctx.write)
      throw new Error("createCatalogProposal.execute requiere write-port (tx).");
    await ctx.write.insertProposalWithOriginator(plan);
    return { affected: AFFECTED };
  },
});
