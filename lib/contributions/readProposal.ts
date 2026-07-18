/**
 * Lectura del detalle de un CatalogProposal (Community Contributions, ADR-006).
 * Vista ADMIN/MODERADOR: agregado completo (todas las contribuciones y claims,
 * incluidas retiradas / OCULTA / EN_CUARENTENA / propuestas terminales). Sin Mutation
 * Framework, MutationLog ni transacciones (es lectura). Confluye no-existe /
 * no-autorizado / flag-off / id-inválido a un único `null` (anti-enumeración: no
 * revela existencia). Una única query con include anidado (sin N+1).
 */
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { isEnabled } from "@/lib/featureFlags";
import { prisma } from "@/lib/prisma";
import {
  toCatalogProposalDetail,
  type CatalogProposalDetail,
} from "@/lib/domain/proposal/readModel";

/**
 * Devuelve el detalle del agregado o `null` si: el flag está apagado, el actor no es
 * admin, el id es inválido o la propuesta no existe (todos indistinguibles hacia
 * afuera). El caller (action/página) mapea `null` a notFound().
 */
export async function getCatalogProposalDetail(
  proposalId: number,
): Promise<CatalogProposalDetail | null> {
  // 1. Feature flag (bloquea incluso a admin).
  if (!(await isEnabled("community-contributions"))) return null;

  // 2. Auth + admin (no revela existencia a anónimos/no-admin).
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return null;

  // 3. Id válido.
  if (!Number.isInteger(proposalId) || proposalId <= 0) return null;

  // 4. Una lectura del agregado (include anidado; orden estable desde la query).
  const row = await prisma.catalogProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true, status: true, family: true, contentClass: true, createdAt: true,
      targetKind: true, refWorkId: true, refEditionId: true, refVolumeId: true,
      refWorkBId: true, relationKind: true,
      contributions: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, createdAt: true, visibility: true, withdrawnAt: true, authorId: true,
          claims: {
            orderBy: { id: "asc" },
            select: {
              id: true, attributeKind: true, contractVersion: true, claimOperation: true,
              value: true, result: true, resultReason: true,
            },
          },
        },
      },
    },
  });
  if (!row) return null;

  return toCatalogProposalDetail(row);
}
