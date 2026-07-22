/**
 * Adjudicación — la costura de JUICIO del subsistema de identidad. PURA (Prisma-free).
 *
 * En la slice Conferir, Adjudicación DECIDE que un contenido es nuevo y emite la intención
 * Conferir. Su frontera (contrato normativo): NO asigna handles, NO consulta ni protege
 * unicidad global, NO persiste, NO toca el namespace. Estructuralmente solo puede construir
 * una Decisión (solo importa el constructor puro `conferDecision`) — esa dependencia mínima ES
 * la prueba de que no puede cruzar hacia la ejecución.
 *
 * El juicio "es nuevo" lo aporta el llamador (la Reconciliación real queda fuera de esta slice):
 * Adjudicación se limita a empaquetar ese juicio como una Decisión válida.
 */
import { conferDecision, type ConferDecision, type ConferDecisionInput } from "./confer";

/** Adjudicación juzgó el contenido NUEVO → emite la Decisión Conferir correspondiente. */
export function adjudicateConferNew(request: ConferDecisionInput): ConferDecision {
  return conferDecision(request);
}
