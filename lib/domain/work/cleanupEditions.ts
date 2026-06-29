/**
 * Dominio: limpieza de ediciones redundantes (mismo Work, mismo normTitle — ej.
 * slugs "is" e "i-quot-s"). PURO. A diferencia de merge/delete, esta operación es
 * BULK y de input vacío: descubre el set sucio en runtime y conserva la canónica de
 * cada grupo, borrando el resto. No tiene "una entidad" → no tiene idempotency key
 * natural (re-correr no encuentra nada: idempotencia inherente, no por clave).
 */

/** Edición mínima para decidir canónica (campos que mira `canonicalEdition`). */
export interface EditionForCleanup {
  id: number;
  slug: string;
  volumes: number;
  anilistId: number | null;
}

/** Grupo de ediciones redundantes del MISMO Work. */
export interface EditionDupGroupLite {
  publisher: string;
  normTitle: string;
  editions: EditionForCleanup[];
}

export interface EditionDeletion {
  id: number; // edición a borrar
  keptId: number; // canónica que queda
  publisher: string;
  normTitle: string;
}

/** El plan es una LISTA (no un registro): pone a prueba la granularidad del preview. */
export type CleanEditionsPlan = EditionDeletion[];

/** Edición canónica de un grupo: con anilistId > más tomos > slug más corto. */
export function canonicalEdition<E extends EditionForCleanup>(eds: E[]): E {
  return [...eds].sort(
    (a, b) =>
      (b.anilistId ? 1 : 0) - (a.anilistId ? 1 : 0) ||
      b.volumes - a.volumes ||
      a.slug.length - b.slug.length,
  )[0];
}

/**
 * Arma el plan de borrado: por cada grupo conserva la canónica y marca el resto.
 * Puro y testeable. Conservador: ignora grupos de <2 (nada que limpiar).
 */
export function planRedundantEditionCleanup(groups: EditionDupGroupLite[]): CleanEditionsPlan {
  const plan: CleanEditionsPlan = [];
  for (const g of groups) {
    if (g.editions.length < 2) continue;
    const keep = canonicalEdition(g.editions);
    for (const e of g.editions) {
      if (e.id === keep.id) continue;
      plan.push({ id: e.id, keptId: keep.id, publisher: g.publisher, normTitle: g.normTitle });
    }
  }
  return plan;
}

// --- Puertos de datos (interfaces; impl en infra) ---

export interface CleanEditionsReadPort {
  /** Detección: grupos de ediciones redundantes del mismo Work (read-only). */
  loadRedundantGroups(): Promise<EditionDupGroupLite[]>;
}

export interface CleanEditionsWritePort {
  /** Borra en bulk; devuelve cuántas borró realmente (puede ser < pedidas). */
  deleteEditions(ids: number[]): Promise<number>;
}
