/**
 * Read model del detalle de una propuesta — vista del USUARIO COMÚN relacionado
 * (originador o aportante), Community Contributions ADR-006. Prisma-free. Contrato
 * PROPIO y distinto del admin: expone SOLO las contribuciones del viewer (nunca
 * ajenas ni sus conteos), sin `authorId`, con `relationship {isOriginator,
 * isContributor}`. Comparte piezas puras con el admin vía `readSerialize.ts`.
 *
 * Fuera de este corte (por depender de slices no construidos): detalle de NEEDS_INFO
 * (ProposalInfoRequest), decisión/outcome de ResolutionRecord, displayTitle derivado.
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

// ---------------------------------------------------------------------------
// Contrato externo
// ---------------------------------------------------------------------------
export interface OwnContributionDetail {
  id: string;
  isOriginating: boolean;
  createdAt: string; // ISO 8601
  visibility: string; // el autor ve su propia contribución aun si OCULTA/EN_CUARENTENA
  withdrawnAt: string | null;
  claims: DetailClaim[];
}

export interface OwnCatalogProposalDetail {
  id: string;
  status: string;
  family: string;
  contentClass: string;
  createdAt: string; // ISO 8601
  relationship: {
    isOriginator: boolean;
    isContributor: boolean;
  };
  target: DetailTarget;
  contributions: OwnContributionDetail[]; // SOLO las del viewer
}

// ---------------------------------------------------------------------------
// Tipos MÍNIMOS de entrada (la query ya filtró a las contribuciones del viewer;
// `authorId` ni se selecciona → no puede filtrarse a este mapper)
// ---------------------------------------------------------------------------
export interface OwnContributionRow {
  id: number;
  createdAt: Date;
  visibility: string;
  withdrawnAt: Date | null;
  claims: ClaimDetailRow[];
}

export interface OwnProposalRow extends DetailTargetRow {
  id: number;
  status: string;
  family: string;
  contentClass: string;
  createdAt: Date;
  contributions: OwnContributionRow[];
}

export interface ViewerRelationship {
  isOriginator: boolean;
  isContributor: boolean;
}

/**
 * Mapea la propuesta + las contribuciones propias al read model. `relationship` lo
 * calcula la capa de aplicación (desde `originatorUserId` — que NO se expone). La
 * contribución más antigua del viewer es la originadora de la propuesta **solo si**
 * el viewer es el originador (su primer aporte originó la propuesta).
 */
export function toOwnCatalogProposalDetail(
  p: OwnProposalRow,
  relationship: ViewerRelationship,
): OwnCatalogProposalDetail {
  const contributions = [...p.contributions].sort(byCreatedThenId);
  const originatingOwnId =
    relationship.isOriginator && contributions.length > 0 ? contributions[0].id : null;

  return {
    id: String(p.id),
    status: p.status,
    family: p.family,
    contentClass: p.contentClass,
    createdAt: p.createdAt.toISOString(),
    relationship: {
      isOriginator: relationship.isOriginator,
      isContributor: relationship.isContributor,
    },
    target: toDetailTarget(p),
    contributions: contributions.map((c) => ({
      id: String(c.id),
      isOriginating: c.id === originatingOwnId,
      createdAt: c.createdAt.toISOString(),
      visibility: c.visibility,
      withdrawnAt: isoOrNull(c.withdrawnAt),
      claims: toSortedDetailClaims(c.claims),
    })),
  };
}
