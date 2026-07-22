/**
 * Caso de uso "Asociar una referencia externa a una Identity existente" (slice de identidad).
 * Flujo: Adjudicación decide asociar → emite la Decisión → el Registro valida el namespace,
 * verifica el destino, asocia atómicamente → Resultado de ejecución. Adaptador mínimo (sin
 * endpoint) para ejercer el caso y los tests. No cruza `runMutation` (contrato de retorno semántico).
 */
import { adjudicateAssociateExternalReference } from "@/lib/domain/identity/associate";
import { prismaAssociateRegistro } from "@/lib/infra/identity/associateRegistro";
import type { AssociateExternalReferenceInput, AssociateResult } from "@/lib/domain/identity/associate";

export { ASSOCIATE_INVARIANT } from "@/lib/domain/identity/associate";
export type { AssociateResult, AssociateExternalReferenceInput } from "@/lib/domain/identity/associate";

export async function associateExternalReferenceUseCase(request: AssociateExternalReferenceInput): Promise<AssociateResult> {
  const decision = adjudicateAssociateExternalReference(request); // Adjudicación → Decisión (sin namespace)
  return prismaAssociateRegistro().associate(decision); // Registro → ejecución atómica + Resultado
}
