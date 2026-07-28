/**
 * Caso de uso "Conferir una Identity" (slice de identidad). Atraviesa el flujo completo:
 *   solicitud → Adjudicación juzga "contenido nuevo" y emite la Decisión → el Registro valida el
 *   namespace, asigna un handle, crea la Identity activa, asocia las referencias semilla y devuelve
 *   un Resultado de ejecución. Sin UI ni endpoint: este facade es el adaptador mínimo para ejercer
 *   el caso (y para los tests). No cruza `runMutation`: el contrato de retorno es un Resultado de
 *   ejecución semántico (3 variantes), no el modelo throw/affected del Mutation Framework; ese
 *   framework se conserva intacto para Apply (ver docs/identity-confer-slice.md).
 */
import { adjudicateConferNew } from "@/lib/domain/identity/adjudication";
import { prismaRegistro } from "@/lib/infra/identity/registro";
import type { ConferDecisionInput, ConferResult } from "@/lib/domain/identity/confer";

export { CONFER_INVARIANT } from "@/lib/domain/identity/confer";
export type { ConferResult, ConferDecisionInput } from "@/lib/domain/identity/confer";

export async function conferIdentityUseCase(request: ConferDecisionInput): Promise<ConferResult> {
  const decision = adjudicateConferNew(request); // Adjudicación → Decisión (dominio; sin namespace)
  return prismaRegistro().confer(decision); // Registro → ejecución atómica + Resultado semántico
}
