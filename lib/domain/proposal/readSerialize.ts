/**
 * Helpers PUROS de serialización compartidos por los read models de propuestas
 * (admin `readModel.ts` y propio `ownReadModel.ts`). Prisma-free. Mantiene un solo
 * lugar para: serialización de ids/fechas, mapeo de target y de claim, y orden
 * estable. Los dos mappers siguen siendo explícitos y con contratos distintos; acá
 * viven solo las piezas idénticas.
 */

export const idOrNull = (n: number | null): string | null =>
  n === null ? null : String(n);

export const isoOrNull = (d: Date | null): string | null =>
  d ? d.toISOString() : null;

export interface HasCreatedAtAndId {
  createdAt: Date;
  id: number;
}

/** Orden estable: createdAt ASC, id ASC. */
export function byCreatedThenId(a: HasCreatedAtAndId, b: HasCreatedAtAndId): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------
export interface DetailTargetRow {
  targetKind: string;
  refWorkId: number | null;
  refEditionId: number | null;
  refVolumeId: number | null;
  refWorkBId: number | null;
  relationKind: string | null;
}

export interface DetailTarget {
  kind: string;
  refWorkId: string | null;
  refEditionId: string | null;
  refVolumeId: string | null;
  refWorkBId: string | null;
  relationKind: string | null;
}

export function toDetailTarget(p: DetailTargetRow): DetailTarget {
  return {
    kind: p.targetKind,
    refWorkId: idOrNull(p.refWorkId),
    refEditionId: idOrNull(p.refEditionId),
    refVolumeId: idOrNull(p.refVolumeId),
    refWorkBId: idOrNull(p.refWorkBId),
    relationKind: p.relationKind,
  };
}

// ---------------------------------------------------------------------------
// Claim
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

export interface DetailClaim {
  id: string;
  attributeKind: string;
  contractVersion: number;
  claimOperation: string;
  value: unknown | null;
  result: string;
  resultReason: string | null;
}

export function toDetailClaim(cl: ClaimDetailRow): DetailClaim {
  return {
    id: String(cl.id),
    attributeKind: cl.attributeKind,
    contractVersion: cl.contractVersion,
    claimOperation: cl.claimOperation,
    value: cl.value ?? null,
    result: cl.result,
    resultReason: cl.resultReason ?? null,
  };
}

/** Claims ordenadas por id ASC y mapeadas al contrato externo. */
export function toSortedDetailClaims(claims: ClaimDetailRow[]): DetailClaim[] {
  return [...claims].sort((a, b) => a.id - b.id).map(toDetailClaim);
}
