/**
 * Admin global por email (configurable por env). FAIL-CLOSED: solo devuelve `true` cuando `ADMIN_EMAIL` está
 * explícitamente configurada (no vacía tras `trim`) y el email recibido coincide EXACTAMENTE con ella. Sin
 * `ADMIN_EMAIL` (ausente, vacía o solo espacios) nadie es admin. No hay fallback literal. No se normaliza el email
 * de sesión (comparación exacta, sin lowercase/aliases/multi-admin): eso ampliaría el contrato.
 */
export function isAdmin(email?: string | null): boolean {
  const configured = (process.env.ADMIN_EMAIL ?? "").trim();
  if (!configured) return false;
  return !!email && email === configured;
}
