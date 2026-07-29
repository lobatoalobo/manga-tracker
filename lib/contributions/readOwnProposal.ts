/**
 * Lectura de una propuesta para el USUARIO COMÚN relacionado (originador o aportante),
 * Community Contributions ADR-006. No es la vista de moderador. Read-only: sin Mutation
 * Framework, MutationLog ni transacciones. Selección MÍNIMA: Prisma trae SOLO las
 * contribuciones del viewer (`where authorId = viewer`), nunca ajenas → no hay riesgo
 * de exposición accidental. Confluye flag-off / sin-sesión / id-inválido / inexistente
 * / no-relacionado a un único `null` (anti-enumeración).
 */
import { auth } from "@/auth";
import { isEnabled } from "@/lib/featureFlags";
import { prisma } from "@/lib/prisma";
import {
  toOwnCatalogProposalDetail,
  type OwnCatalogProposalDetail,
} from "@/lib/domain/proposal/ownReadModel";

export async function getOwnCatalogProposalDetail(
  proposalId: number,
): Promise<OwnCatalogProposalDetail | null> {
  // 1. Feature flag.
  if (!(await isEnabled("community-contributions"))) return null;

  // 2. Sesión (cualquier usuario; NO admin). Sin sesión → null.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  // 3. Id válido.
  if (!Number.isInteger(proposalId) || proposalId <= 0) return null;

  // 4. Una lectura: propuesta + SOLO las contribuciones del viewer.
  const row = await prisma.catalogProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true, status: true, family: true, contentClass: true, createdAt: true,
      targetKind: true, refWorkId: true, refEditionId: true, refVolumeId: true,
      refWorkBId: true, relationKind: true,
      originatorUserId: true, // SOLO para autorizar / derivar isOriginator; NO se expone
      contributions: {
        where: { authorId: userId }, // solo lo propio
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, createdAt: true, visibility: true, withdrawnAt: true,
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

  // 5. Autorización: originador o aportante. Si no está relacionado → null.
  const isOriginator = row.originatorUserId === userId;
  const isContributor = row.contributions.length > 0;
  if (!isOriginator && !isContributor) return null;

  return toOwnCatalogProposalDetail(row, { isOriginator, isContributor });
}
