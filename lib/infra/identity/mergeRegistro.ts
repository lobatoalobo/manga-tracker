/**
 * Infra: el Registro de Identidad para la slice "Fusionar", con Prisma. Custodio del NAMESPACE
 * únicamente: idempotencia, locks de Identity, validación bajo lock, movimiento de referencias,
 * transición a REDIRECTED, redirección y procedencia. NO abre transacción, NO commitea/revierte, NO
 * llama a Catálogo, NO decide cuál sobrevive, NO combina contenido, NO modifica Works, NO expone CRUD.
 *
 * La operación se parte en DOS fases (para intercalar la absorción de contenido de Catálogo en el medio,
 * como exige ADR-008: validar identidades → absorber Works → mutar namespace), pero AMBAS fases viven acá:
 * el coordinador de aplicación solo las secuencia e inyecta la llamada a Catálogo, sin lógica de namespace.
 *
 *   1. `prepareIdentityMergeInTx`: idempotencia (decisionId-primero) + lock `FOR UPDATE` de ambas
 *      identidades (ordenado por id) + revalidación bajo lock. Devuelve `READY` (con los Work ids que
 *      Catálogo necesita) o un Resultado temprano (ALREADY_*, REJECTED, DECISION_ID_REUSED_DIVERGENTLY).
 *   2. `applyIdentityMergeInTx`: mover referencias (identityId absorbida → sobreviviente) y flipear la
 *      absorbida a REDIRECTED con su procedencia. El ORDEN (mover antes de flipear) es obligatorio y
 *      además forzado por la FK compuesta de ADR-009 (ON UPDATE RESTRICT).
 *
 * Concurrencia: `SELECT … FOR UPDATE` sobre AMBAS identidades ordenadas por id (anti-deadlock). El lock se
 * mantiene por toda la tx del coordinador (misma tx) → serializa fusiones que comparten una identidad; la
 * absorción de Catálogo (que lockea Works) ocurre DESPUÉS del lock de identidades (orden global congelado:
 * Identities → Works). `READ COMMITTED` alcanza (la relectura bajo lock ve el estado comprometido).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  IDENTITY_STATE_REDIRECTED,
  MERGE_REASON,
  mergeDecisionFingerprint,
  mergeAlreadySatisfied,
  mergeAlreadyMerged,
  mergeRejected,
  type MergeDecision,
  type MergeResult,
} from "@/lib/domain/identity/merge";

const IDENTITY_STATE_ACTIVE = "ACTIVE" as const;

/** Puerto de datos mínimo (subconjunto de la tx de Prisma). Incluye `$queryRaw` para el lock. */
export type MergeDb = Pick<Prisma.TransactionClient, "catalogIdentity" | "identityExternalReference" | "$queryRaw">;
/** Cliente para relecturas frescas fuera de una tx abortada (resolución de conflicto). */
export type MergeClient = Pick<PrismaClient, "catalogIdentity">;

/** Merge listo para ejecutar: la absorbida y sobreviviente validadas bajo lock, con sus Work ids. */
export interface PreparedMerge {
  readonly kind: "READY";
  readonly survivingHandle: number;
  readonly absorbedHandle: number;
  readonly survivingWorkId: number;
  readonly absorbedWorkId: number;
}
/** El resultado de la fase 1: o está listo, o es un Resultado temprano (idempotencia/rechazo). */
export type PrepareOutcome = PreparedMerge | MergeResult;

/** Colisión de unicidad de `mergeDecisionId` perdida bajo concurrencia; se resuelve FUERA de la tx. */
export class MergeConflict extends Error {
  constructor() {
    super("merge decisionId conflict");
    this.name = "MergeConflict";
  }
}

/** Nombre del índice único de procedencia (para reconocer el P2002 de replay concurrente). */
export const MERGE_DECISION_ID_CONSTRAINT = "CatalogIdentity_mergeDecisionId_key";

/** ¿El error es la violación del único `mergeDecisionId` (replay concurrido)? Dependencia acotada de Prisma. */
export function isMergeDecisionIdConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const s = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return s.includes("mergeDecisionId");
}

const handles = (d: MergeDecision) => ({ survivingHandle: d.survivingHandle, absorbedHandle: d.absorbedHandle });

/** Replay de un `mergeDecisionId` existente: misma huella → idempotente; distinta → reuso divergente. */
function resolveExistingDecision(prior: { mergeDecisionFingerprint: string | null }, d: MergeDecision): MergeResult {
  if (prior.mergeDecisionFingerprint === mergeDecisionFingerprint(d)) return mergeAlreadySatisfied(handles(d));
  return mergeRejected(MERGE_REASON.DECISION_ID_REUSED_DIVERGENTLY, "El decisionId fue reutilizado con una intención diferente.");
}

const LOAD_SELECT = {
  id: true,
  state: true,
  redirectsToId: true,
  contentClass: true,
  designatedWorkId: true,
  mergeDecisionId: true,
  mergeDecisionFingerprint: true,
} as const;

/**
 * FASE 1 — idempotencia + lock + validación bajo lock. Devuelve un `READY` con los Work ids que el
 * coordinador pasa a Catálogo, o un Resultado temprano. NO escribe nada (solo lee y lockea).
 */
export async function prepareIdentityMergeInTx(db: MergeDb, decision: MergeDecision): Promise<PrepareOutcome> {
  const { survivingHandle: s, absorbedHandle: a } = decision;

  // Red de seguridad: el constructor ya rechaza handles iguales, pero una Decisión construida a mano
  // podría traerlos → SAME_IDENTITY (resultado, no excepción; el Registro no confía ciegamente en su input).
  if (s === a) return mergeRejected(MERGE_REASON.SAME_IDENTITY, "La sobreviviente y la absorbida son la misma identidad.");

  // 1. Idempotencia decisionId-PRIMERO (global, pre-lock): ¿esta decisión ya redirigió una identidad?
  const prior = await db.catalogIdentity.findUnique({ where: { mergeDecisionId: decision.decisionId }, select: { mergeDecisionFingerprint: true } });
  if (prior) return resolveExistingDecision(prior, decision);

  // 2. Lock pesimista de AMBAS identidades, ordenado por id (anti-deadlock). No usa el resultado; solo bloquea.
  const [lo, hi] = s < a ? [s, a] : [a, s];
  await db.$queryRaw(Prisma.sql`SELECT id FROM "CatalogIdentity" WHERE id IN (${lo}, ${hi}) ORDER BY id FOR UPDATE`);

  // 3. Relectura bajo lock (patrón R1): existencia + estados comprometidos.
  const surv = await db.catalogIdentity.findUnique({ where: { id: s }, select: LOAD_SELECT });
  if (!surv) return mergeRejected(MERGE_REASON.IDENTITY_NOT_FOUND, "La identidad sobreviviente no existe.", { missing: "survivor" });
  const abs = await db.catalogIdentity.findUnique({ where: { id: a }, select: LOAD_SELECT });
  if (!abs) return mergeRejected(MERGE_REASON.IDENTITY_NOT_FOUND, "La identidad absorbida no existe.", { missing: "absorbed" });

  // 4. Idempotencia por ESTADO (bajo lock): la absorbida ya está redirigida.
  if (abs.state === IDENTITY_STATE_REDIRECTED || abs.redirectsToId !== null) {
    if (abs.redirectsToId === s) {
      // Ya redirige a la MISMA sobreviviente. ¿Fue esta misma decisión (replay que commiteó entre el paso
      // 1 y el lock) o una decisión distinta con el mismo fin?
      if (abs.mergeDecisionId === decision.decisionId) return resolveExistingDecision(abs, decision);
      return mergeAlreadyMerged(handles(decision));
    }
    // Redirige a OTRA identidad: contradicción, no idempotencia.
    return mergeRejected(MERGE_REASON.INVALID_ABSORBED_STATE, "La identidad absorbida ya redirige hacia otra identidad.");
  }

  // 5. La sobreviviente debe estar ACTIVE (sin redirect).
  if (surv.state !== IDENTITY_STATE_ACTIVE || surv.redirectsToId !== null)
    return mergeRejected(MERGE_REASON.INVALID_SURVIVOR_STATE, "La identidad sobreviviente no está activa (no puede recibir una fusión).");

  // 6. La absorbida debe estar ACTIVE (ya sabemos que no redirige; validar estado explícito).
  if (abs.state !== IDENTITY_STATE_ACTIVE)
    return mergeRejected(MERGE_REASON.INVALID_ABSORBED_STATE, "La identidad absorbida no está activa.");

  // 7. Clases de contenido compatibles.
  if (surv.contentClass !== abs.contentClass)
    return mergeRejected(MERGE_REASON.CONTENT_CLASS_INCOMPATIBLE, "Las clases de contenido de ambas identidades no coinciden.");

  // 8. Regla anti-cadena v1: la absorbida no puede tener redirecciones ENTRANTES (crearía una cadena).
  const incoming = await db.catalogIdentity.findFirst({ where: { redirectsToId: a }, select: { id: true } });
  if (incoming)
    return mergeRejected(MERGE_REASON.REDIRECT_DEPENDENTS_PRESENT, "La identidad absorbida tiene redirecciones entrantes; v1 no encadena redirecciones.");

  return { kind: "READY", survivingHandle: s, absorbedHandle: a, survivingWorkId: surv.designatedWorkId, absorbedWorkId: abs.designatedWorkId };
}

/**
 * FASE 2 — mutación del namespace bajo el lock ya adquirido en la fase 1 (misma tx). Mueve las referencias
 * de la absorbida a la sobreviviente y flipea la absorbida a REDIRECTED con su procedencia. Devuelve la
 * cantidad de referencias movidas (el coordinador arma el EXECUTED con el conteo de Catálogo). Un P2002 de
 * `mergeDecisionId` (replay concurrido) se relanza como `MergeConflict` para resolverlo fuera de la tx.
 */
export async function applyIdentityMergeInTx(db: MergeDb, decision: MergeDecision, prepared: PreparedMerge): Promise<{ movedReferences: number }> {
  const s = prepared.survivingHandle;
  const a = prepared.absorbedHandle;

  // 1) Mover referencias PRIMERO (la sobreviviente es ACTIVE → identityState 'ACTIVE' sigue válido para la
  //    FK compuesta de ADR-009). Debe ir antes del flip: la FK ON UPDATE RESTRICT rechaza el flip si aún
  //    quedan referencias apuntando a (absorbida, 'ACTIVE').
  const moved = await db.identityExternalReference.updateMany({ where: { identityId: a }, data: { identityId: s } });

  // 2) Flipear la absorbida a REDIRECTED + redirección + procedencia (todo en un UPDATE).
  try {
    await db.catalogIdentity.update({
      where: { id: a },
      data: {
        state: IDENTITY_STATE_REDIRECTED,
        redirectsToId: s,
        mergeDecisionId: decision.decisionId,
        mergeDecisionFingerprint: mergeDecisionFingerprint(decision),
      },
      select: { id: true },
    });
  } catch (err) {
    if (isMergeDecisionIdConflict(err)) throw new MergeConflict();
    throw err;
  }

  return { movedReferences: moved.count };
}

/**
 * Traduce un `MergeConflict` (colisión de `mergeDecisionId` perdida bajo concurrencia) a Resultado, con
 * una lectura fresca fuera de la tx abortada. decisionId-primero: si la decisión ya existe → replay
 * (idempotente) o reuso divergente. Coherente con el protocolo de Conferir/Asociar.
 */
export async function resolveMergeConflict(client: MergeClient, decision: MergeDecision): Promise<MergeResult> {
  const prior = await client.catalogIdentity.findUnique({ where: { mergeDecisionId: decision.decisionId }, select: { mergeDecisionFingerprint: true } });
  if (prior) return resolveExistingDecision(prior, decision);
  // Sin fila por decisionId: la colisión no era de esta decisión (no debería ocurrir para P2002 de
  // mergeDecisionId). Reportar un rechazo coherente en vez de inventar éxito.
  return mergeRejected(MERGE_REASON.INVALID_ABSORBED_STATE, "Colisión de procedencia al fusionar.");
}

/** Cliente de producción para la resolución de conflicto (Prisma global). */
export function prismaMergeClient(): MergeClient {
  return prisma;
}
