/**
 * Caso de uso "Fusionar dos identidades" (slice de identidad). Coordinador de APLICACIÓN (ADR-008,
 * Alternativa B): abre UNA transacción Prisma y compone, en ese orden, la validación del namespace, la
 * absorción de contenido de Catálogo y la mutación del namespace. El dominio permanece separado por
 * contexto; el único acoplamiento es la frontera transaccional. No cruza `runMutation` (retorno semántico).
 *
 * Orden global de locks CONGELADO: Identidades → Works. La fase 1 del Registro lockea ambas identidades
 * `FOR UPDATE`; recién entonces Catálogo lockea ambos Works. Ninguna otra operación adquiere Works antes
 * que Identidades, así que no hay deadlock entre caminos.
 *
 *   Adjudicación → MergeDecision
 *   → mergeIdentities: prisma.$transaction
 *      1. prepareIdentityMergeInTx  (idempotencia + lock identidades + validación → READY | resultado)
 *      2. absorbWorkInTx            (Catálogo: re-parentar ediciones + marcar Work absorbido)   [T1]
 *      3. applyIdentityMergeInTx    (mover referencias + flipear a REDIRECTED + procedencia)
 *   → MergeResult (todo o nada)
 *
 * Si Catálogo NO permite continuar (cualquier REJECTED), no se ejecuta la mutación del namespace y no
 * queda nada persistido (Catálogo rechaza antes de escribir; la absorción y el namespace comparten la tx).
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { absorbWorkInTx, type CatalogAbsorbDb } from "@/lib/infra/catalog/absorbWork";
import { absorbWorkCommand } from "@/lib/domain/catalog/absorbWork";
import {
  adjudicateMergeIdentities,
  MERGE_REASON,
  mergeExecuted,
  mergeRejected,
  type MergeDecision,
  type MergeDecisionInput,
  type MergeResult,
  type MergeIdentitiesUseCase,
} from "@/lib/domain/identity/merge";
import {
  prepareIdentityMergeInTx,
  applyIdentityMergeInTx,
  resolveMergeConflict,
  MergeConflict,
  type MergeDb,
  type MergeClient,
} from "@/lib/infra/identity/mergeRegistro";

export { MERGE_REASON } from "@/lib/domain/identity/merge";
export type { MergeResult, MergeDecisionInput } from "@/lib/domain/identity/merge";

/** Cliente capaz de abrir la frontera transaccional (inyectable: prod usa el global; integración inyecta uno). */
export type MergeCoordinatorClient = Pick<PrismaClient, "$transaction"> & MergeClient;

/** La tx del coordinador debe servir a AMBOS write-ports (namespace + Catálogo). */
type MergeTx = MergeDb & CatalogAbsorbDb;

/**
 * Traduce un rechazo de Catálogo (que aborta la fusión) al Resultado de Fusionar, sin borrar la distinción.
 * `CONTENT_CONFLICT_REQUIRES_JUDGMENT` se propaga tal cual (con sus slots). Los rechazos de estado del Work
 * (que solo aparecerían si un Work cambió de estado bajo nosotros pese al lock de identidades) se mapean al
 * estado de identidad equivalente. `SAME_WORK`/`WORK_NOT_FOUND` no son alcanzables desde una fusión válida
 * (dos identidades ACTIVE designan Works distintos y existentes por FK Restrict) → error técnico ruidoso.
 */
function mapCatalogRejection(reason: string, message: string, conflicts?: readonly { publisher: string; language: string }[]): MergeResult {
  switch (reason) {
    case "CONTENT_CONFLICT_REQUIRES_JUDGMENT":
      return mergeRejected(MERGE_REASON.CONTENT_CONFLICT_REQUIRES_JUDGMENT, message, { conflicts });
    case "INVALID_SURVIVOR_STATE":
      return mergeRejected(MERGE_REASON.INVALID_SURVIVOR_STATE, "El contenido de la sobreviviente cambió de estado (fue absorbido).");
    case "INVALID_ABSORBED_STATE":
      return mergeRejected(MERGE_REASON.INVALID_ABSORBED_STATE, "El contenido de la absorbida cambió de estado (ya fue absorbido).");
    default:
      throw new Error(`Rechazo de Catálogo inesperado en una fusión válida: ${reason} (${message}).`);
  }
}

/** Núcleo de la fusión DENTRO de la tx del coordinador. Devuelve el Resultado; una excepción revierte todo. */
async function mergeInTx(tx: MergeTx, decision: MergeDecision): Promise<MergeResult> {
  // 1. Namespace: idempotencia + lock de identidades + validación. Devuelve los Work ids si está listo.
  const prepared = await prepareIdentityMergeInTx(tx, decision);
  if (prepared.kind !== "READY") return prepared; // ALREADY_* / REJECTED / DECISION_ID_REUSED_DIVERGENTLY

  // 2. Catálogo (T1): absorber el Work de la absorbida dentro del de la sobreviviente (lockea Works).
  const cat = await absorbWorkInTx(
    tx,
    absorbWorkCommand({ survivingWorkId: prepared.survivingWorkId, absorbedWorkId: prepared.absorbedWorkId }),
  );
  if (cat.kind === "REJECTED") return mapCatalogRejection(cat.reason, cat.message, cat.conflicts);
  // EXECUTED o ALREADY_ABSORBED permiten continuar. La dirección de ALREADY_ABSORBED coincide por
  // construcción (absorbWorkInTx solo devuelve ALREADY_ABSORBED cuando el absorbido ya apunta a ESTE
  // sobreviviente; cualquier otro destino es INVALID_ABSORBED_STATE), así que es seguro proseguir.
  const reparentedEditions = cat.kind === "EXECUTED" ? cat.reparentedEditions : 0;

  // 3. Namespace: mover referencias + flipear la absorbida a REDIRECTED con procedencia (bajo el lock del paso 1).
  const applied = await applyIdentityMergeInTx(tx, decision, prepared);

  return mergeExecuted({
    survivingHandle: prepared.survivingHandle,
    absorbedHandle: prepared.absorbedHandle,
    survivingWorkId: prepared.survivingWorkId,
    absorbedWorkId: prepared.absorbedWorkId,
    reparentedEditions,
    movedReferences: applied.movedReferences,
  });
}

/** Construye el caso de uso sobre un cliente Prisma dado (prod usa el global; integración inyecta uno). */
export function makeMergeIdentities(client: MergeCoordinatorClient): MergeIdentitiesUseCase {
  return {
    async merge(decision) {
      try {
        return await client.$transaction((tx) => mergeInTx(tx as unknown as MergeTx, decision), { timeout: 20000 });
      } catch (err) {
        // Colisión de `mergeDecisionId` perdida bajo concurrencia (replay concurrido): la tx abortó; se
        // reclasifica con una lectura fresca fuera de ella (decisionId-primero).
        if (err instanceof MergeConflict) return resolveMergeConflict(client, decision);
        throw err;
      }
    },
  };
}

/** El caso de uso de producción (cliente Prisma global). */
export function prismaMergeIdentities(): MergeIdentitiesUseCase {
  return makeMergeIdentities(prisma);
}

/** Adaptador mínimo end-to-end: Adjudicación construye la Decisión → el coordinador la ejecuta. */
export async function mergeIdentitiesUseCase(request: MergeDecisionInput): Promise<MergeResult> {
  const decision = adjudicateMergeIdentities(request); // Adjudicación → Decisión (dominio; sin namespace)
  return prismaMergeIdentities().merge(decision);
}
