import { prisma } from "@/lib/prisma";

/**
 * Borra la cuenta del usuario y todos sus datos personales (derecho de supresión,
 * Ley 25.326). La mayoría de las tablas del dominio cascadean desde `User`
 * (mangas → ediciones → tomos, compras, deseados, notas, amistades, actividad,
 * notificaciones, prefs, push, mutes, accounts, sessions). Acá limpiamos a mano
 * lo que NO tiene FK con cascade:
 *  - LoginEvent: log con datos personales (nombre/email/imagen) → se borra.
 *  - Report: se anonimiza (se conserva la corrección de datos, sin dueño).
 *  - Store / IndieWork: contenido de la comunidad → se conserva, se desvincula
 *    del autor (submittedBy → null).
 */
export async function deleteAccount(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.loginEvent.deleteMany({ where: { userId } }),
    prisma.report.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.store.updateMany({ where: { submittedBy: userId }, data: { submittedBy: null } }),
    prisma.indieWork.updateMany({ where: { submittedBy: userId }, data: { submittedBy: null } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
