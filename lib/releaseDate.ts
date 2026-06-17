const MONTHS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/**
 * Formatea la etiqueta de salida borrosa para mostrar. Client-safe.
 *   "2026"    → "2026"
 *   "2026-07" → "jul 2026"
 */
export function formatReleaseLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const ym = label.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const m = Number(ym[2]) - 1;
    return MONTHS[m] ? `${MONTHS[m]} ${ym[1]}` : ym[1];
  }
  const y = label.match(/^(\d{4})$/);
  return y ? y[1] : null;
}

/** Formatea una fecha exacta de salida ("3 jul 2026"). Client-safe. */
export function formatProximaDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Normaliza un input a "YYYY" o "YYYY-MM" válido, o null si no se entiende. */
export function normalizeReleaseLabel(
  label: string | null | undefined,
): string | null {
  if (!label) return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(label)) return label;
  if (/^\d{4}$/.test(label)) return label;
  return null;
}
