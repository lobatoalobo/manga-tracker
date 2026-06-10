/**
 * Convierte un valor ingresado por el usuario (web o red social) en un href
 * absoluto. Evita que valores como "tienda.com.ar" o "@usuario" se traten como
 * links relativos del propio sitio.
 */
export function externalHref(value: string): string {
  const t = value.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("@")) return `https://instagram.com/${t.slice(1)}`;
  return `https://${t.replace(/^\/+/, "")}`;
}
