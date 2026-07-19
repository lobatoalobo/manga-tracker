/**
 * Mutación `resolveCatalogProposal` (Community Contributions, ADR-006). Resolución
 * final de una propuesta por un admin: decide (ACEPTADA|RECHAZADA), registra el
 * ResolutionRecord y los outcomes de las claims, y transiciona a terminal. NO aplica
 * al catálogo. ORQUESTACIÓN pura sobre el Mutation Framework: la operación indivisible
 * (lock → replay → validar → create RR → resolver claims → transición) vive en el
 * write-port (infra). No conoce Prisma. La auditoría NO incluye privateNote ni el
 * contenido/valores de las claims.
 */
import { defineMutation, ValidationError } from "@/lib/mutations";
import {
  OUTCOME_ACCEPTED,
  OUTCOME_REJECTED,
  type ResolveReadPort,
  type ResolveSeed,
  type ResolveWritePort,
} from "@/lib/domain/proposal/resolve";

const created = (claimCount: number) => ({
  creates: 1, // ResolutionRecord
  updates: claimCount + 1, // N ProposalClaim + CatalogProposal (terminal + version)
  deletes: 0,
  entities: ["ResolutionRecord", "ProposalClaim", "CatalogProposal"] as const,
});
const RECOVERED = { creates: 0, updates: 0, deletes: 0 };

export const resolveCatalogProposal = defineMutation<
  ResolveSeed,
  ResolveSeed,
  ResolveReadPort,
  ResolveWritePort
>({
  name: "resolveCatalogProposal",
  definitionVersion: 1,
  kind: "CONTRIB_RESOLVE_PROPOSAL",
  policy: { maxAffected: 1002 }, // 1 RR + hasta ~1000 claims + 1 propuesta
  idempotency: (i) => ({ key: i.idempotencyKey, scope: "resolveCatalogProposal" }),

  // Barato (la semilla ya viene normalizada/validada del use-case).
  validate(_ctx, seed) {
    if (seed.outcome !== OUTCOME_ACCEPTED && seed.outcome !== OUTCOME_REJECTED)
      throw new ValidationError("outcome de resolución inválido.");
  },

  async preview(_ctx, seed) {
    return {
      affected: created(seed.claimOutcomes.length),
      irreversible: false,
      // summary SIN publicReason/privateNote ni valores de claims (no filtrar a auditoría).
      summary: {
        domain: "resolveCatalogProposal",
        human: `Resuelve la propuesta ${seed.proposalId} como ${seed.outcome} con ${seed.claimOutcomes.length} claim(s).`,
      },
      plan: seed,
    };
  },

  async execute(ctx, _input, plan) {
    if (!ctx.write)
      throw new Error("resolveCatalogProposal.execute requiere write-port (tx).");
    const r = await ctx.write.resolve(plan);
    return { affected: r.recovered ? RECOVERED : created(plan.claimOutcomes.length) };
  },
});
