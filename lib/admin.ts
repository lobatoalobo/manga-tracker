/** Email del dueño/admin (configurable por env). */
export function isAdmin(email?: string | null): boolean {
  const adminEmail = process.env.ADMIN_EMAIL ?? "alobato@evisit.com";
  return !!email && email === adminEmail;
}
