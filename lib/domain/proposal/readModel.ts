/**
 * Read model del detalle de un CatalogProposal (Community Contributions, ADR-006).
 * Prisma-free: define el contrato EXTERNO estable, los tipos MÍNIMOS de entrada del
 * mapper (subconjunto de columnas — los campos internos ni se leen) y el mapper PURO
 * (serialización + `isOriginating` + orden determinista). No expone entidades Prisma,
 * `Date`, `Decimal`, `BigInt` ni campos internos. Vista admin/moderador: incluye TODO
 * (retiradas, OCULTA, EN_CUARENTENA); no filtra por visibility.
 */

// ---------------------------------------------------------------------------
// Contrato externo (serializable y estable)
// ---------------------------------------------------------------------------
export interface CatalogProposalDetailClaim {
  id: string;
  attributeKind: string;
  contractVersion: number;
  claimOperation: string;
  value: unknown | null;
  result: string;
  resultReason: string | null;
}

export interface CatalogProposalDetailContribution {
  id: string;
  isOriginating: boolean;
  createdAt: string; // ISO 8601
  visibility: string;
  withdrawnAt: string | null; // ISO 8601 | null
  authorId: string | null; // crudo, SOLO en esta vista admin
  claims: CatalogProposalDetailClaim[];
}

export interface CatalogProposalDetail {
  id: string;
  status: string;
  family: string;
  contentClass: string;
  createdAt: string; // ISO 8601
  target: {
    kind: string;
    refWorkId: string | null;
    refEditionId: string | null;
    refVolumeId: string | null;
    refWorkBId: string | null;
    relationKind: string | null;
  };
  contributions: CatalogProposalDetailContribution[];
}

// ---------------------------------------------------------------------------
// Tipos MÍNIMOS de entrada del mapper (lo que la query selecciona; nada más)
// ---------------------------------------------------------------------------
export interface ClaimDetailRow {
  id: number;
  attributeKind: string;
  contractVersion: number;
  claimOperation: string;
  value: unknown | null;
  result: string;
  resultReason: string | null;
}

export interface ContributionDetailRow {
  id: number;
  createdAt: Date;
  visibility: string;
  withdrawnAt: Date | null;
  authorId: string | null;
  claims: ClaimDetailRow[];
}

export interface ProposalDetailRow {
  id: number;
  status: string;
  family: string;
  contentClass: string;
  createdAt: Date;
  targetKind: string;
  refWorkId: number | null;
  refEditionId: number | null;
  refVolumeId: number | null;
  refWorkBId: number | null;
  relationKind: string | null;
  contributions: ContributionDetailRow[];
}

// ---------------------------------------------------------------------------
// Helpers de serialización / orden
// ---------------------------------------------------------------------------
const idOrNull = (n: number | null): string | null => (n === null ? null : String(n));

/** Orden estable de contribuciones: createdAt ASC, id ASC. */
function byCreatedThenId(a: ContributionDetailRow, b: ContributionDetailRow): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
}

/**
 * Mapea la fila del agregado al read model. Determinista: ordena contribuciones
 * (createdAt, id) y claims (id), y deriva `isOriginating` = la más antigua por ese
 * mismo criterio (sin columna dedicada). No depende del orden de entrada.
 */
export function toCatalogProposalDetail(p: ProposalDetailRow): CatalogProposalDetail {
  const contributions = [...p.contributions].sort(byCreatedThenId);
  const originatingId = contributions.length > 0 ? contributions[0].id : null;

  return {
    id: String(p.id),
    status: p.status,
    family: p.family,
    contentClass: p.contentClass,
    createdAt: p.createdAt.toISOString(),
    target: {
      kind: p.targetKind,
      refWorkId: idOrNull(p.refWorkId),
      refEditionId: idOrNull(p.refEditionId),
      refVolumeId: idOrNull(p.refVolumeId),
      refWorkBId: idOrNull(p.refWorkBId),
      relationKind: p.relationKind,
    },
    contributions: contributions.map((c) => ({
      id: String(c.id),
      isOriginating: c.id === originatingId,
      createdAt: c.createdAt.toISOString(),
      visibility: c.visibility,
      withdrawnAt: c.withdrawnAt ? c.withdrawnAt.toISOString() : null,
      authorId: c.authorId ?? null,
      claims: [...c.claims]
        .sort((a, b) => a.id - b.id)
        .map((cl) => ({
          id: String(cl.id),
          attributeKind: cl.attributeKind,
          contractVersion: cl.contractVersion,
          claimOperation: cl.claimOperation,
          value: cl.value ?? null,
          result: cl.result,
          resultReason: cl.resultReason ?? null,
        })),
    })),
  };
}
