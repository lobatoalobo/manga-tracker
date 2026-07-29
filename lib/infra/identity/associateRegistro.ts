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
import { IDENTITY_STATE_ACTIVE } from "@/lib/domain/identity/confer";
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

/** El destino dejó de ser ACTIVE entre el pre-check y el insert (guardia FK compuesta de ADR-009). */
class AssociateInvalidTargetState extends Error {
  constructor() {
    super("associate invalid target state");
    this.name = "AssociateInvalidTargetState";
  }
}

/** Nombre de la FK compuesta de ADR-009 (`(identityId, identityState) → CatalogIdentity(id, state)`). */
export const REFERENCE_ACTIVE_FK_CONSTRAINT = "IdentityExternalReference_identity_active_fkey";

/**
 * Clasificación ACOTADA del conflicto de FK: ¿es la violación de la FK compuesta de estado activo?
 * Encapsula la ÚNICA dependencia respecto de cómo Prisma reporta el P2003. Metadata real observada
 * (Prisma 6 / PG 18, base efímera): `code='P2003'`, `meta.constraint='IdentityExternalReference_
 * identity_active_fkey'`. Se acepta también `meta.field_name` como respaldo por si otra versión de
 * Prisma reporta el nombre por ese campo. NO es un traductor universal: reconoce SOLO esta FK; un
 * P2003 de otra causa devuelve `false` (→ error técnico, no se convierte en `INVALID_IDENTITY_STATE`).
 */
export function isReferenceActiveFkViolation(code: string | undefined, meta: unknown): boolean {
  if (code !== "P2003") return false;
  const m = (meta ?? {}) as { constraint?: unknown; field_name?: unknown };
  const constraint = String(m.constraint ?? "");
  const fieldName = String(m.field_name ?? "");
  return constraint.includes(REFERENCE_ACTIVE_FK_CONSTRAINT) || fieldName.includes(REFERENCE_ACTIVE_FK_CONSTRAINT);
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
        // `identityState` (ADR-009): detalle de persistencia, SIEMPRE ACTIVE. NO viene de Adjudicación
        // ni del usuario, NO está en la Decisión ni en el fingerprint. Es la mitad "estado" de la FK
        // compuesta que garantiza que el destino sea ACTIVE (guardia autoritativa bajo concurrencia).
        identityState: IDENTITY_STATE_ACTIVE,
        provider: decision.provider,
        externalId: decision.externalId,
        decisionId: decision.decisionId,
        decisionFingerprint: associateDecisionFingerprint(decision),
      },
      select: { id: true },
    });
    return assocExecuted(toRef(decision));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") throw new AssociateConflict();
      // Guardia autoritativa de ADR-009: el destino dejó de ser ACTIVE bajo carrera → la FK compuesta
      // rechaza el insert. Solo esta FK reconocida se traduce; otro P2003 propaga como error técnico.
      if (isReferenceActiveFkViolation(err.code, err.meta)) throw new AssociateInvalidTargetState();
    }
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
        if (err instanceof AssociateInvalidTargetState)
          return assocRejected(ASSOCIATE_INVARIANT.INVALID_IDENTITY_STATE, "La Identity destino dejó de estar ACTIVE.");
        throw err;
      }
    },
  };
}

export function prismaAssociateRegistro(): AssociateReferenceRegistro {
  return makeAssociateRegistro(prisma);
}
