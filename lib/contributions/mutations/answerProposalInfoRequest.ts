/**
 * Mutación `answerProposalInfoRequest` (Community Contributions, ADR-006). El
 * originador responde un InfoRequest ABIERTO. ORQUESTACIÓN pura sobre el Mutation
 * Framework: la operación indivisible (lock → originador → replay → validar request
 * → create contribución+claims → cerrar request → transición condicional) vive en el
 * write-port (infra). No conoce Prisma. No audita el contenido de las claims.
 */
import { defineMutation, ValidationError } from "@/lib/mutations";
import {
  type AnswerReadPort,
  type AnswerSeed,
  type AnswerWritePort,
} from "@/lib/domain/proposal/answerInfo";

const created = (claimCount: number) => ({
  creates: 1 + claimCount, // ProposalContribution + N ProposalClaim
  updates: 2, // ProposalInfoRequest (ANSWERED) + CatalogProposal (SUBMITTED + version)
  deletes: 0,
  entities: ["ProposalContribution", "ProposalClaim", "ProposalInfoRequest", "CatalogProposal"] as const,
});
const RECOVERED = { creates: 0, updates: 0, deletes: 0 };

export const answerProposalInfoRequest = defineMutation<
  AnswerSeed,
  AnswerSeed,
  AnswerReadPort,
  AnswerWritePort
>({
  name: "answerProposalInfoRequest",
  definitionVersion: 1,
  kind: "CONTRIB_ANSWER_INFO",
  policy: { maxAffected: 53 }, // 1 contribución + hasta 50 claims + 2 updates
  idempotency: (i) => ({ key: i.idempotencyKey, scope: "answerProposalInfoRequest" }),

  // Barato (la semilla ya viene normalizada/validada del use-case).
  validate(_ctx, seed) {
    if (!Array.isArray(seed.claims) || seed.claims.length < 1)
      throw new ValidationError("La respuesta requiere al menos un claim.");
  },

  async preview(_ctx, seed) {
    return {
      affected: created(seed.claims.length),
      irreversible: false,
      // summary SIN contenido de claims (no filtrar a la auditoría).
      summary: {
        domain: "answerProposalInfoRequest",
        human: `Responde la solicitud ${seed.infoRequestId} de la propuesta ${seed.proposalId} con ${seed.claims.length} claim(s).`,
      },
      plan: seed,
    };
  },

  async execute(ctx, _input, plan) {
    if (!ctx.write)
      throw new Error("answerProposalInfoRequest.execute requiere write-port (tx).");
    const r = await ctx.write.answer(plan);
    return { affected: r.recovered ? RECOVERED : created(plan.claims.length) };
  },
});
