/**
 * Infra de Catálogo: el write-port "absorber un Work dentro de otro" (ADR-008), con Prisma.
 * RECIBE un `TransactionClient` externo y NO abre/confirma/revierte su propia transacción: el futuro
 * caso de uso de Fusionar compondrá, en UNA tx, la absorción de contenido (esto) + la fusión del
 * namespace (Registro de Identidad). NO modifica `CatalogIdentity`, NO juzga conflictos, NO expone CRUD.
 *
 * Concurrencia: lockea AMBOS Works con `SELECT … FOR UPDATE` ordenados por `id` (anti-deadlock) y
 * revalida bajo lock. Orden de mutación: re-parentar ediciones PRIMERO, marcar `absorbedIntoId` DESPUÉS
 * (así el absorbido nunca queda marcado con ediciones todavía colgando de él). Todo dentro de la tx dada
 * → atómico (o el coordinador commitea el conjunto o revierte todo).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ABSORB_REASON,
  absorbExecuted,
  absorbAlreadyAbsorbed,
  absorbRejected,
  type AbsorbWorkCommand,
  type CatalogAbsorptionResult,
  type EditionConflict,
} from "@/lib/domain/catalog/absorbWork";

/** Puerto de datos mínimo (subconjunto de la tx de Prisma). Incluye `$queryRaw` para el lock. */
export type CatalogAbsorbDb = Pick<Prisma.TransactionClient, "work" | "publisherEdition" | "$queryRaw">;

/** Colisión de ediciones: slots (publisher, language) presentes en AMBOS Works. No se resuelve acá. */
async function detectEditionConflicts(tx: CatalogAbsorbDb, survivingWorkId: number, absorbedWorkId: number): Promise<EditionConflict[]> {
  const [surv, abs] = await Promise.all([
    tx.publisherEdition.findMany({ where: { workId: survivingWorkId }, select: { publisher: true, language: true } }),
    tx.publisherEdition.findMany({ where: { workId: absorbedWorkId }, select: { publisher: true, language: true } }),
  ]);
  const key = (p: string, l: string) => JSON.stringify([p, l]);
  const survSlots = new Set(surv.map((e) => key(e.publisher, e.language)));
  const conflicts: EditionConflict[] = [];
  const seen = new Set<string>();
  for (const e of abs) {
    const k = key(e.publisher, e.language);
    if (survSlots.has(k) && !seen.has(k)) {
      conflicts.push({ publisher: e.publisher, language: e.language });
      seen.add(k);
    }
  }
  return conflicts;
}

/**
 * Absorbe `absorbedWorkId` dentro de `survivingWorkId` DENTRO de la transacción dada. Todos los rechazos
 * retornan ANTES de escribir. Idempotente por estado: si el absorbido ya apunta al mismo sobreviviente,
 * `ALREADY_ABSORBED` (sin decisionId — el protocolo de decisión es del futuro coordinador).
 */
export async function absorbWorkInTx(tx: CatalogAbsorbDb, command: AbsorbWorkCommand): Promise<CatalogAbsorptionResult> {
  const s = command.survivingWorkId;
  const a = command.absorbedWorkId;
  if (s === a) return absorbRejected(ABSORB_REASON.SAME_WORK, "El sobreviviente y el absorbido son el mismo Work.");

  // 1. Lock de ambos Works, ordenado por id (anti-deadlock). No usa el resultado; solo bloquea.
  const [lo, hi] = s < a ? [s, a] : [a, s];
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Work" WHERE id IN (${lo}, ${hi}) ORDER BY id FOR UPDATE`);

  // 2. Revalidar estados bajo lock.
  const surv = await tx.work.findUnique({ where: { id: s }, select: { id: true, absorbedIntoId: true } });
  if (!surv) return absorbRejected(ABSORB_REASON.WORK_NOT_FOUND, "El Work sobreviviente no existe.", { missing: "survivor" });
  const abs = await tx.work.findUnique({ where: { id: a }, select: { id: true, absorbedIntoId: true } });
  if (!abs) return absorbRejected(ABSORB_REASON.WORK_NOT_FOUND, "El Work absorbido no existe.", { missing: "absorbed" });

  // 3. Idempotencia por estado: ya absorbido en el MISMO sobreviviente.
  if (abs.absorbedIntoId === s) return absorbAlreadyAbsorbed(s, a);

  // 4. Estados válidos.
  if (surv.absorbedIntoId !== null)
    return absorbRejected(ABSORB_REASON.INVALID_SURVIVOR_STATE, "El sobreviviente ya está absorbido: no puede recibir contenido.");
  if (abs.absorbedIntoId !== null)
    return absorbRejected(ABSORB_REASON.INVALID_ABSORBED_STATE, "El absorbido ya está absorbido en otro Work.");

  // 5. v1 no encadena: el absorbido no puede tener absorciones entrantes (sería un survivor previo).
  const incoming = await tx.work.findFirst({ where: { absorbedIntoId: a }, select: { id: true } });
  if (incoming)
    return absorbRejected(ABSORB_REASON.INVALID_ABSORBED_STATE, "El absorbido tiene absorciones entrantes; v1 no encadena absorciones.");

  // 6. Conflicto de contenido (colisión de slot de edición) → requiere juicio; Catálogo no lo resuelve.
  const conflicts = await detectEditionConflicts(tx, s, a);
  if (conflicts.length > 0)
    return absorbRejected(
      ABSORB_REASON.CONTENT_CONFLICT_REQUIRES_JUDGMENT,
      "Sobreviviente y absorbido comparten uno o más slots de edición (publisher+idioma); requiere juicio.",
      { conflicts },
    );

  // 7. Re-parentar ediciones PRIMERO, luego marcar el absorbido (orden seguro; atómico en la tx dada).
  const reparent = await tx.publisherEdition.updateMany({ where: { workId: a }, data: { workId: s } });
  await tx.work.update({ where: { id: a }, data: { absorbedIntoId: s } });
  return absorbExecuted(s, a, reparent.count);
}

/** Puerto específico de Catálogo (no repositorio genérico). El futuro coordinador lo invoca con SU tx. */
export interface CatalogMergeWriter {
  absorbWorkInto(tx: Prisma.TransactionClient, command: AbsorbWorkCommand): Promise<CatalogAbsorptionResult>;
}

export const catalogMergeWriter: CatalogMergeWriter = {
  absorbWorkInto: (tx, command) => absorbWorkInTx(tx, command),
};

/** Tipo de cliente que puede abrir la frontera transaccional (para tests que controlan la tx). Prod
 * NO abre una tx propia: el coordinador de Fusionar lo hará. No se expone un caso de uso público. */
export type CatalogTxClient = Pick<PrismaClient, "$transaction">;
