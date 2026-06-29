/**
 * Dominio: identidad de un Work. PURO. Invariante de CICLO DE VIDA compartido por
 * todas las operaciones que tocan data de usuario (merge, delete): la colección,
 * deseados, notas, etc. NO se clavan por `workId` sino por la "clave de dominio" de
 * la serie. Antes esta fórmula estaba duplicada en `mergeWorks`/`deleteWork`; al
 * migrar `deleteWork` al framework emergió como el primer invariante compartido
 * (ver ADR-002, "Work lifecycle invariants").
 */

/**
 * Clave de dominio de un Work: positiva = `anilistId` (la serie en AniList; así se
 * clavan colección/deseados), negativa = `-id` para obras locales sin anilistId.
 * Es EXCLUSIVA del Work salvo que comparta anilistId con otro (caso que el merge
 * resuelve, no el delete).
 */
export function workDomainKey(work: { anilistId: number | null; id: number }): number {
  return work.anilistId ?? -work.id;
}
