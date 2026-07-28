/**
 * Infra: el Registro de Identidad para la slice "Conferir", implementado con Prisma. Custodio
 * del namespace: valida los invariantes GLOBALES y ejecuta la Decisión atómicamente, devolviendo
 * un Resultado de ejecución semántico (NO throw/booleano). NO juzga (no decide si el contenido es
 * nuevo) y NO modifica la Decisión para volverla válida.
 *
 * Enforcement de invariantes globales — camino amable (pre-check en memoria) + guardia
 * AUTORITATIVA en base (restricciones únicas) traducida a Resultado ante concurrencia:
 * - Designación única: pre-check por identidad ACTIVE + índice parcial `WHERE state='ACTIVE'`.
 * - Unicidad de referencia: pre-check + `@@unique(provider, externalId)`.
 * - Idempotencia semántica: `decisionId` único + huella semántica (`decisionFingerprint`). Misma
 *   decisión (misma huella) → ALREADY_SATISFIED; mismo `decisionId` con intención distinta →
 *   REJECTED por reuso divergente; mismo contenido con otro `decisionId` → DESIGNATION_TAKEN.
 * - Atomicidad: identidad + referencias semilla en una operación anidada; un conflicto en cualquier
 *   referencia aborta toda la transacción (sin identidad parcial).
 *
 * SEMÁNTICA DE ASIGNACIÓN DEL HANDLE (normativa): el handle es el `id` SERIAL (sequence de
 * Postgres). La sequence NO es transaccional: un valor consumido por un INSERT que luego aborta
 * (p. ej. P2002 bajo concurrencia) NO se devuelve. Por lo tanto: (a) los handles NO prometen
 * contigüidad — puede haber huecos; (b) un valor consumido por una operación abortada puede no
 * materializarse; (c) un handle NUNCA se reutiliza (las filas no se borran y la sequence solo
 * avanza). Esto es COMPATIBLE con el invariante de frescura/no-reuso: un hueco es un valor que
 * nadie usó (aún más seguro que reusar). El Registro NO acuña handles en memoria.
 *
 * Semántica transaccional de Postgres: un P2002 aborta la transacción, así que NO se lee tras el
 * conflicto dentro de la tx. El `create` lanza un `ConferConflict` tipado (ya CLASIFICADO) fuera
 * de la tx; el conflicto se traduce a Resultado con lecturas frescas sobre el cliente base.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  IDENTITY_STATE_ACTIVE,
  CONFER_INVARIANT,
  birthIdentity,
  conferDecisionFingerprint,
  executed,
  alreadySatisfied,
  rejected,
  type ConferDecision,
  type ConferResult,
  type ConferredIdentity,
  type IdentityRegistro,
} from "@/lib/domain/identity/confer";

/** Puerto de datos mínimo que Conferir necesita (subconjunto de la tx de Prisma). */
export type ConferDb = Pick<Prisma.TransactionClient, "catalogIdentity" | "identityExternalReference" | "work">;
/** Cliente capaz de abrir la frontera transaccional (inyectable para tests de integración). */
export type RegistroClient = Pick<PrismaClient, "$transaction" | "catalogIdentity">;

/**
 * Clasificación de un conflicto de unicidad (P2002) por el invariante global que lo produjo. Es
 * la ÚNICA dependencia respecto de cómo Prisma/Postgres reportan el conflicto, encapsulada y
 * testeada. Depende de que `meta.target` contenga el nombre de campo del constraint — cierto en
 * ambas formas que Prisma usa: array de campos (constraints del schema) o el NOMBRE del índice
 * (para el índice parcial crudo), porque nombramos los índices con sus campos. No es un traductor
 * universal de errores Prisma: solo cubre los tres constraints de esta slice.
 */
export type ConferConflictKind = "DECISION_ID" | "DESIGNATION" | "REFERENCE" | "UNKNOWN";

export function classifyConferConflict(target: unknown): ConferConflictKind {
  const s = Array.isArray(target) ? target.join(",") : String(target ?? "");
  if (s.includes("decisionId")) return "DECISION_ID";
  if (s.includes("designatedWorkId") || s.includes("active")) return "DESIGNATION";
  if (s.includes("provider") || s.includes("externalId")) return "REFERENCE";
  return "UNKNOWN";
}

/** Conflicto de unicidad detectado en el `create` (ya clasificado); se resuelve FUERA de la tx. */
class ConferConflict extends Error {
  constructor(readonly kind: ConferConflictKind) {
    super("confer uniqueness conflict");
    this.name = "ConferConflict";
  }
}

const toConferred = (row: { id: number; contentClass: string; designatedWorkId: number }): ConferredIdentity => ({
  handle: row.id,
  state: IDENTITY_STATE_ACTIVE,
  contentClass: row.contentClass,
  designatedWorkId: row.designatedWorkId,
});

/** Resuelve el replay de un `decisionId` existente: misma huella → idempotente; distinta → reuso
 * divergente. Centraliza la comparación semántica (usada en el pre-check y en el conflicto P2002). */
function resolveExistingDecision(
  prior: { id: number; contentClass: string; designatedWorkId: number; decisionFingerprint: string },
  decision: ConferDecision,
): ConferResult {
  if (prior.decisionFingerprint === conferDecisionFingerprint(decision)) return alreadySatisfied(toConferred(prior));
  return rejected(CONFER_INVARIANT.DECISION_ID_REUSED_DIVERGENTLY, "El decisionId fue reutilizado con una intención diferente.");
}

const PRIOR_SELECT = { id: true, contentClass: true, designatedWorkId: true, decisionFingerprint: true } as const;

/**
 * Núcleo del Registro dentro de una transacción. Los rechazos del camino amable devuelven un
 * Resultado ANTES de escribir (la tx compromete vacío). El único write es el `create`; si colisiona
 * (P2002) lanza `ConferConflict` clasificado para resolverlo fuera de la tx abortada.
 */
export async function conferInTx(db: ConferDb, decision: ConferDecision): Promise<ConferResult> {
  // 0. Idempotencia SEMÁNTICA: ¿este decisionId ya confirió una identidad? Misma huella →
  //    idempotente; distinta → reuso divergente (rechazo). El identificador manda primero.
  const prior = await db.catalogIdentity.findUnique({ where: { decisionId: decision.decisionId }, select: PRIOR_SELECT });
  if (prior) return resolveExistingDecision(prior, decision);

  // 1. El contenido designado debe existir (y su tipo da la coherencia de clase).
  const work = await db.work.findUnique({ where: { id: decision.designatedWorkId }, select: { id: true, type: true } });
  if (!work) return rejected(CONFER_INVARIANT.DESIGNATED_CONTENT_NOT_FOUND, "El contenido designado no existe.");

  // 2. Clase coherente con el contenido designado.
  if (work.type !== decision.contentClass)
    return rejected(CONFER_INVARIANT.CONTENT_CLASS_INCOMPATIBLE, "La clase declarada no coincide con la del contenido designado.");

  // 3. Designación única (camino amable): ninguna identidad ACTIVE designa ya este contenido.
  const active = await db.catalogIdentity.findFirst({
    where: { designatedWorkId: decision.designatedWorkId, state: IDENTITY_STATE_ACTIVE },
    select: { id: true },
  });
  if (active) return rejected(CONFER_INVARIANT.DESIGNATION_TAKEN, "El contenido ya está designado por una identidad activa.");

  // 4. Unicidad de referencia (camino amable): ninguna semilla está ya ligada.
  for (const ref of decision.seedReferences) {
    const bound = await db.identityExternalReference.findUnique({
      where: { provider_externalId: { provider: ref.provider, externalId: ref.externalId } },
      select: { id: true },
    });
    if (bound) return rejected(CONFER_INVARIANT.REFERENCE_ALREADY_BOUND, "Una referencia semilla ya resuelve a otra identidad.");
  }

  // 5. Nacimiento local (afirma invariantes intra-identidad) + persistencia atómica. El handle lo
  //    asigna la DB (sequence; ver nota normativa de arriba). Identidad + referencias en un create.
  birthIdentity(decision);
  try {
    const created = await db.catalogIdentity.create({
      data: {
        state: IDENTITY_STATE_ACTIVE,
        contentClass: decision.contentClass,
        designatedWorkId: decision.designatedWorkId,
        decisionId: decision.decisionId,
        decisionFingerprint: conferDecisionFingerprint(decision),
        externalRefs: decision.seedReferences.length
          ? {
              // `identityState` (ADR-009): detalle de persistencia, SIEMPRE ACTIVE (la identidad
              // nace ACTIVE en la misma tx). No forma parte de la decisión ni del fingerprint.
              create: decision.seedReferences.map((r) => ({ provider: r.provider, externalId: r.externalId, identityState: IDENTITY_STATE_ACTIVE })),
            }
          : undefined,
      },
      select: { id: true, contentClass: true, designatedWorkId: true },
    });
    return executed(toConferred(created));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      throw new ConferConflict(classifyConferConflict(err.meta?.target));
    throw err;
  }
}

/**
 * Traduce un conflicto de unicidad (perdido bajo concurrencia) a Resultado, con lecturas frescas
 * sobre el cliente base (la tx quedó abortada). El Registro sigue sin juzgar: solo reporta qué
 * invariante global ganó la carrera.
 */
async function resolveConflict(client: RegistroClient, kind: ConferConflictKind, decision: ConferDecision): Promise<ConferResult> {
  // La MISMA decisión DOMINA: una decisión repetida colisiona a la vez en decisionId, designación y
  // referencia; Postgres reporta cualquiera de ellos. Por eso se re-lee por decisionId PRIMERO (sin
  // importar el constraint reportado): si existe, es replay (idempotente/divergente). Recién si NO es
  // la misma decisión se distingue designación vs referencia por el `kind` reportado.
  const now = await client.catalogIdentity.findUnique({ where: { decisionId: decision.decisionId }, select: PRIOR_SELECT });
  if (now) return resolveExistingDecision(now, decision);
  if (kind === "REFERENCE") return rejected(CONFER_INVARIANT.REFERENCE_ALREADY_BOUND, "Una referencia semilla ya resuelve a otra identidad.");
  return rejected(CONFER_INVARIANT.DESIGNATION_TAKEN, "El contenido ya está designado por una identidad activa.");
}

/** Construye el Registro sobre un cliente Prisma dado (inyectable: prod usa el global; los tests
 * de integración inyectan un cliente hacia una base desechable). */
export function makeRegistro(client: RegistroClient): IdentityRegistro {
  return {
    async confer(decision) {
      try {
        return await client.$transaction((tx) => conferInTx(tx, decision), { timeout: 15000 });
      } catch (err) {
        if (err instanceof ConferConflict) return resolveConflict(client, err.kind, decision);
        throw err;
      }
    },
  };
}

/** El Registro de producción (cliente Prisma global). */
export function prismaRegistro(): IdentityRegistro {
  return makeRegistro(prisma);
}
