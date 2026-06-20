/**
 * Reglas de "número de tomo plausible" para una edición. ÚNICA fuente de verdad
 * (server + form) → no se desincronizan. El catálogo puede estar algo atrasado,
 * así que se permite un margen sobre el conteo conocido; más allá es un typo
 * (ej. tomo 500 de una serie de 10).
 */

/** Tope plausible de tomo dado el conteo conocido (0/desconocido = sin tope). */
export function volumeCap(known: number): number {
  return known > 0 ? known + Math.max(5, Math.round(known * 0.3)) : Infinity;
}

/** ¿El tomo `vol` es plausible para una edición con `known` tomos conocidos? */
export function isPlausibleVolume(known: number, vol: number): boolean {
  return vol > 0 && vol <= volumeCap(known);
}
