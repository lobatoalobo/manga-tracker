/**
 * Read model del detalle de un CatalogProposal — vista ADMIN/MODERADOR (Community
 * Contributions, ADR-006). Prisma-free: contrato EXTERNO estable + tipos MÍNIMOS de
 * entrada + mapper PURO. Incluye TODO (retiradas, OCULTA, EN_CUARENTENA; abiertas y
 * terminales); no filtra por visibility. Serialización/target/claim se comparten con
 * la vista propia vía `readSerialize.ts` (piezas puras idénticas).
 */
import {
  byCreatedThenId,
  isoOrNull,
  toDetailTarget,
  toSortedDetailClaims,
  type ClaimDetailRow,
  type DetailClaim,
  type DetailTarget,
  type DetailTargetRow,
} from "./readSerialize";

export type { ClaimDetailRow } from "./readSerialize";

// ---------------------------------------------------------------------------
// Contrato externo (serializable y estable)
// ---------------------------------------------------------------------------
export type CatalogProposalDetailClaim = DetailClaim;

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
  target: DetailTarget;
  contributions: CatalogProposalDetailContribution[];
}

// ---------------------------------------------------------------------------
// Tipos MÍNIMOS de entrada del mapper (lo que la query selecciona; nada más)
// ---------------------------------------------------------------------------
export interface ContributionDetailRow {
  id: number;
  createdAt: Date;
  visibility: string;
  withdrawnAt: Date | null;
  authorId: string | null;
  claims: ClaimDetailRow[];
}

export interface ProposalDetailRow extends DetailTargetRow {
  id: number;
  status: string;
  family: string;
  contentClass: string;
  createdAt: Date;
  contributions: ContributionDetailRow[];
}

/**
 * Mapea la fila del agregado al read model admin. Determinista: ordena contribuciones
 * (createdAt, id) y claims (id), y deriva `isOriginating` = la más antigua.
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
    target: toDetailTarget(p),
    contributions: contributions.map((c) => ({
      id: String(c.id),
      isOriginating: c.id === originatingId,
      createdAt: c.createdAt.toISOString(),
      visibility: c.visibility,
      withdrawnAt: isoOrNull(c.withdrawnAt),
      authorId: c.authorId ?? null,
      claims: toSortedDetailClaims(c.claims),
    })),
  };
}
