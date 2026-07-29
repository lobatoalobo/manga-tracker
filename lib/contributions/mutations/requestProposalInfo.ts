/**
 * Mutación `requestProposalInfo` (Community Contributions, ADR-006) — primer paso de
 * moderación. ORQUESTACIÓN pura sobre el Mutation Framework: la decisión indivisible
 * (lock + replay + estado + create + transición) vive en el write-port (infra), que
 * usa las reglas puras del dominio. No conoce Prisma. Crea un ProposalInfoRequest y
 * lleva la propuesta a NEEDS_INFO, o recupera el replay idempotente.
 */
import { defineMutation, ValidationError } from "@/lib/mutations";
import {
  MAX_MESSAGE_LENGTH,
  type RequestInfoReadPort,
  type RequestInfoSeed,
  type RequestInfoWritePort,
} from "@/lib/domain/proposal/requestInfo";

const CREATED = {
  creates: 1, // ProposalInfoRequest
  updates: 1, // CatalogProposal (status + version)
  deletes: 0,
  entities: ["ProposalInfoRequest", "CatalogProposal"] as const,
};
const RECOVERED = { creates: 0, updates: 0, deletes: 0 };

export const requestProposalInfo = defineMutation<
  RequestInfoSeed,
  RequestInfoSeed,
  RequestInfoReadPort,
  RequestInfoWritePort
>({
  name: "requestProposalInfo",
  definitionVersion: 1,
  kind: "CONTRIB_REQUEST_INFO",
  policy: { maxAffected: 2 },
  idempotency: (i) => ({ key: i.idempotencyKey, scope: "requestProposalInfo" }),

  // Re-chequeo barato (la semilla ya viene normalizada/validada del use-case).
  // NO audita el prompt ni la privateNote.
  validate(_ctx, seed) {
    if (!seed.prompt || seed.prompt.length < 1 || seed.prompt.length > MAX_MESSAGE_LENGTH)
      throw new ValidationError("Mensaje público inválido.");
    if (seed.privateNote !== null && seed.privateNote.length > MAX_MESSAGE_LENGTH)
      throw new ValidationError("Nota privada inválida.");
  },

  async preview(_ctx, seed) {
    return {
      affected: CREATED,
      irreversible: false,
      // summary SIN prompt/privateNote (no filtrar contenido a la auditoría).
      summary: {
        domain: "requestProposalInfo",
        human: `Solicita información en la propuesta ${seed.proposalId} (→ NEEDS_INFO).`,
      },
      plan: seed,
    };
  },

  // Operación indivisible en el write-port; el resultado (creado/recuperado) se captura.
  async execute(ctx, _input, plan) {
    if (!ctx.write)
      throw new Error("requestProposalInfo.execute requiere write-port (tx).");
    const r = await ctx.write.requestInfo(plan);
    return { affected: r.recovered ? RECOVERED : CREATED };
  },
});
