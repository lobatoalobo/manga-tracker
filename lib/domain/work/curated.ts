/**
 * Dominio: protección de campos CURADOS. PURO. Primer invariante TRANSVERSAL del
 * sistema — no pertenece a una entidad puntual sino que protege ATRIBUTOS editados
 * a mano por el admin de que cualquier job/enrich los pise. Vivía duplicado/disperso
 * en 5 archivos (enrichWorks, whakoomImport, ivreaProximas, vizImport, authorMerge);
 * acá queda UNA vez. Es un *mutation constraint primitive* del dominio, no del
 * framework. Storage: `Work.curated String[]` = nombres de campos protegidos.
 */

/** ¿El campo está protegido (editado a mano)? Ningún enrich debe pisarlo. */
export function isCurated(curated: readonly string[], field: string): boolean {
  return curated.includes(field);
}

/**
 * Filtra un patch de enriquecimiento: descarta los campos curados. Es el guard que
 * toda la familia 4 (enrich/backfill) debe aplicar antes de escribir.
 */
export function dropCuratedFields<T extends Record<string, unknown>>(
  patch: T,
  curated: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch)) {
    if (!isCurated(curated, key)) (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

/** Marca campos como curados (lado admin: editó a mano → ningún job los pisa). */
export function markCurated(curated: readonly string[], ...fields: string[]): string[] {
  return [...new Set([...curated, ...fields])];
}
