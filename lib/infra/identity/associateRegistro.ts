/**
 * Infra: el Registro de Identidad para la slice "Asociar una referencia externa", con Prisma.
 * Custodio del namespace: valida existencia y estado del destino, protege la unicidad de
 * referencia, ejecuta atómicamente y devuelve un Resultado semántico. NO juzga correspondencia
 * (no elige otra Identity si la propuesta es inválida) y NO substituye el destino.
 *
 * Atomicidad: la asociación es UNA sola fila (referencia + decisión + huella), así que "registro de
 * decisión", "asociación de referencia" y "estado para replay" son inseparables por construcción.
 * Semántica transaccional de Postgres (aborta tras P2002): el conflicto se relanza y se resuelve
 * FUERA de la tx con lecturas frescas. Resolución por decisionId-primero (la MISMA decisión domina:
 * colisiona en decisionId Y en (provider,externalId) a la vez, así que no se confía en qué constraint
 * reportó Postgres). Con solo dos constraints no hace falta clasificar `meta.target`.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ASSOCIATE_INVARIANT,
  associateDecisionFingerprint,
  isAssociableState,
  assocExecuted,
  assocAlreadySatisfied,
  assocAlreadyAssociated,
  assocRejected,
  type AssociateExternalReferenceDecision,
  type AssociateResult,
  type AssociatedReference,
  type AssociateReferenceRegistro,
} from "@/lib/domain/identity/associate";

/** Puerto de datos mínimo (subconjunto de la tx de Prisma). */
export type AssociateDb = Pick<Prisma.TransactionClient, "catalogIdentity" | "identityExternalReference">;
/** Cliente para la frontera transaccional (inyectable para integración). */
export type AssociateClient = Pick<PrismaClient, "$transaction" | "identityExternalReference">;

class AssociateConflict extends Error {
  constructor() {
    super("associate uniqueness conflict");
    this.name = "AssociateConflict";
  }
}

const toRef = (d: AssociateExternalReferenceDecision): AssociatedReference => ({ handle: d.targetHandle, provider: d.provider, externalId: d.externalId });

/** Replay de un `decisionId` existente: misma huella → idempotente; distinta → reuso divergente. */
function resolveExistingDecision(prior: { decisionFingerprint: string | null }, decision: AssociateExternalReferenceDecision): AssociateResult {
  if (prior.decisionFingerprint === associateDecisionFingerprint(decision)) return assocAlreadySatisfied(toRef(decision));
  return assocRejected(ASSOCIATE_INVARIANT.DECISION_ID_REUSED_DIVERGENTLY, "El decisionId fue reutilizado con una intención diferente.");
}

/** Estado ya satisfecho por otra decisión vs conflicto de destino, dado el binding actual. */
function classifyBinding(boundIdentityId: number, decision: AssociateExternalReferenceDecision): AssociateResult {
  if (boundIdentityId === decision.targetHandle) return assocAlreadyAssociated(toRef(decision));
  return assocRejected(ASSOCIATE_INVARIANT.REFERENCE_ALREADY_BOUND, "La referencia ya resuelve hacia otra identidad.");
}

/**
 * Núcleo del Registro dentro de una transacción. Los rechazos del camino amable devuelven ANTES de
 * escribir. El único write es el `create` de la referencia; un P2002 relanza `AssociateConflict`
 * clasificado para resolverlo fuera de la tx.
 */
export async function associateInTx(db: AssociateDb, decision: AssociateExternalReferenceDecision): Promise<AssociateResult> {
  // 0. Idempotencia SEMÁNTICA por decisionId (la decisión quedó registrada en la fila de referencia).
  const prior = await db.identityExternalReference.findUnique({ where: { decisionId: decision.decisionId }, select: { decisionFingerprint: true } });
  if (prior) return resolveExistingDecision(prior, decision);

  // 1. Existencia del destino (no-colgado) + su estado local.
  const target = await db.catalogIdentity.findUnique({ where: { id: decision.targetHandle }, select: { id: true, state: true } });
  if (!target) return assocRejected(ASSOCIATE_INVARIANT.IDENTITY_NOT_FOUND, "La Identity destino no existe.");

  // 2. Destino válido según su estado (regla local de Identity).
  if (!isAssociableState(target.state)) return assocRejected(ASSOCIATE_INVARIANT.INVALID_IDENTITY_STATE, "La Identity destino no puede recibir referencias en su estado actual.");

  // 3. Unicidad de referencia (camino amable): ¿la referencia ya está ligada? A quién decide el resultado.
  const bound = await db.identityExternalReference.findUnique({
    where: { provider_externalId: { provider: decision.provider, externalId: decision.externalId } },
    select: { identityId: true },
  });
  if (bound) return classifyBinding(bound.identityId, decision);

  // 4. Asociación atómica (una fila: referencia + decisión + huella).
  try {
    await db.identityExternalReference.create({
      data: {
        identityId: decision.targetHandle,
        provider: decision.provider,
        externalId: decision.externalId,
        decisionId: decision.decisionId,
        decisionFingerprint: associateDecisionFingerprint(decision),
      },
      select: { id: true },
    });
    return assocExecuted(toRef(decision));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AssociateConflict();
    throw err;
  }
}

/**
 * Traduce el conflicto (perdido bajo concurrencia) a Resultado, con lecturas frescas fuera de la tx.
 * decisionId-primero: si la MISMA decisión ya existe → replay (idempotente/divergente), sin importar
 * qué constraint reportó Postgres. Recién si NO es la misma decisión, la referencia está ligada →
 * ¿mismo destino (ALREADY_ASSOCIATED) o distinto (REFERENCE_ALREADY_BOUND)?
 */
async function resolveConflict(client: AssociateClient, decision: AssociateExternalReferenceDecision): Promise<AssociateResult> {
  const byDecision = await client.identityExternalReference.findUnique({ where: { decisionId: decision.decisionId }, select: { decisionFingerprint: true } });
  if (byDecision) return resolveExistingDecision(byDecision, decision);

  const byRef = await client.identityExternalReference.findUnique({
    where: { provider_externalId: { provider: decision.provider, externalId: decision.externalId } },
    select: { identityId: true },
  });
  if (byRef) return classifyBinding(byRef.identityId, decision);

  return assocRejected(ASSOCIATE_INVARIANT.REFERENCE_ALREADY_BOUND, "Colisión de unicidad al asociar.");
}

/** Construye el Registro sobre un cliente Prisma dado (prod usa el global; integración inyecta uno). */
export function makeAssociateRegistro(client: AssociateClient): AssociateReferenceRegistro {
  return {
    async associate(decision) {
      try {
        return await client.$transaction((tx) => associateInTx(tx, decision), { timeout: 15000 });
      } catch (err) {
        if (err instanceof AssociateConflict) return resolveConflict(client, decision);
        throw err;
      }
    },
  };
}

export function prismaAssociateRegistro(): AssociateReferenceRegistro {
  return makeAssociateRegistro(prisma);
}
