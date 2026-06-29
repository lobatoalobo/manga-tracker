/**
 * Dominio: borrado de un Work. PURO. Borrar es un HARD delete irreversible: se va
 * el Work, sus ediciones y TODA la data de usuario clavada a su clave de dominio
 * (colección, deseados, notas, actividad…). Es para duplicados que el detector de
 * "Series duplicadas" no agarra. Comparte el invariante `workDomainKey` con el
 * merge (ver lib/domain/work/identity).
 *
 * Reglas (puras): es irreversible SIEMPRE; si hay colección real de usuarios, se
 * ADVIERTE (no se bloquea) que quizá convenía FUSIONAR en vez de borrar.
 */
import { workDomainKey } from "@/lib/domain/work/identity";

export interface DeleteWorkInput {
  workId: number;
}

export interface DeleteWorkIdentity {
  id: number;
  title: string;
  anilistId: number | null;
}

/** Magnitud del borrado (dependencias que se rompen). */
export interface DeleteWorkImpact {
  editions: number;
  collection: number; // Mangas (usuarios que tienen la obra)
  wishlist: number;
}

export interface DeleteWorkPlan {
  workId: number;
  domainKey: number;
}

export function buildDeleteWorkPlan(work: { id: number; anilistId: number | null }): DeleteWorkPlan {
  return { workId: work.id, domainKey: workDomainKey(work) };
}

/**
 * Advertencias para el humano antes de confirmar. La colección real es la señal de
 * que el borrado puede ser un error (lo correcto sería fusionar). No bloquea: el
 * admin decide, pero con confirmación obligatoria (ver la policy de la mutación).
 */
export function deleteWorkWarnings(impact: DeleteWorkImpact): string[] {
  const w: string[] = [];
  if (impact.collection > 0)
    w.push(
      `${impact.collection} usuario(s) tienen esta obra en su colección — el borrado es ` +
        `IRREVERSIBLE; ¿no convendría FUSIONAR en vez de borrar?`,
    );
  if (impact.wishlist > 0) w.push(`${impact.wishlist} ítem(s) de deseados se perderán.`);
  return w;
}

// --- Puertos de datos (interfaces; impl en infra) ---

export interface DeleteWorkReadPort {
  loadIdentity(id: number): Promise<DeleteWorkIdentity | null>;
  impact(plan: DeleteWorkPlan): Promise<DeleteWorkImpact>;
}

export interface DeleteWorkWritePort {
  /** Lock pesimista del Work (serializa borrados sobre el mismo id). */
  lockWork(id: number): Promise<void>;
  /** Aplica el borrado; devuelve la magnitud real eliminada. */
  applyDelete(plan: DeleteWorkPlan): Promise<DeleteWorkImpact>;
}
