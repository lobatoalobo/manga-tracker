/**
 * Collection (Slice 8) — auditoría y reparación del drift entre el ledger `Acquisition` (fuente de verdad) y la
 * cantidad persistida en `OwnershipPosition`. Fuera del camino normal del usuario (lo dispara un script). Ver
 * ADR-010 §D2/§6. La lógica vive acá (Prisma-facing) y el script `scripts/audit-ownership.ts` es un wrapper
 * fino (patrón del repo: cf. `fix-volume-overcounts.ts` → `capOvercountedIvreaEditions`).
 *
 * ## Política de reparación (documentada)
 * La reparación NUNCA borra ni inventa adquisiciones. Alinea cada posición a `Σ Acquisition` del par:
 *  - MISSING (hay adquisiciones, no hay posición) → se crea la posición con la suma.
 *  - MISMATCH (posición ≠ suma) → se actualiza a la suma.
 *  - ORPHAN_NONZERO (posición sin adquisiciones, cantidad ≠ 0) → se lleva a 0 (Σ = 0). La fila NO se borra.
 *
 * ## Concurrencia
 * La detección es un snapshot (puede quedar viejo), pero la REPARACIÓN no escribe una suma calculada afuera:
 * recomputa `Σ` DENTRO de la transacción, DESPUÉS de tomar el lock `FOR UPDATE` de la `OwnershipPosition`. Como
 * el apply inserta la Acquisition e incrementa la posición en UNA sola tx, la reparación ve ambos o ninguno →
 * nunca pierde una adquisición que entró entre el cálculo y la escritura.
 */
import { type PrismaClient } from "@prisma/client";
import { dbRetry } from "@/lib/dbRetry";

type Client = PrismaClient;

export type OwnershipDriftKind = "MISSING" | "MISMATCH" | "ORPHAN_NONZERO";
export interface OwnershipDrift {
  userId: string;
  volumeId: number;
  kind: OwnershipDriftKind;
  positionQuantity: number | null; // null = no hay fila de posición
  acquisitionsSum: number;
}

/** Detecta el drift (read-only). Orden determinista por `(userId, volumeId)`. */
export async function detectOwnershipDrift(client: Client): Promise<OwnershipDrift[]> {
  const sums = await dbRetry(() =>
    client.acquisition.groupBy({
      by: ["userId", "volumeId"],
      _sum: { quantity: true },
      orderBy: [{ userId: "asc" }, { volumeId: "asc" }],
    }),
  );
  const positions = await dbRetry(() =>
    client.ownershipPosition.findMany({
      select: { userId: true, volumeId: true, quantity: true },
      orderBy: [{ userId: "asc" }, { volumeId: "asc" }],
    }),
  );

  const key = (u: string, v: number) => `${u}|${v}`;
  const posByKey = new Map(positions.map((p) => [key(p.userId, p.volumeId), p.quantity]));
  const sumByKey = new Map<string, { userId: string; volumeId: number; sum: number }>();
  for (const g of sums) sumByKey.set(key(g.userId, g.volumeId), { userId: g.userId, volumeId: g.volumeId, sum: g._sum.quantity ?? 0 });

  const drifts: OwnershipDrift[] = [];
  // Pares CON adquisiciones: faltante o distinto.
  for (const { userId, volumeId, sum } of sumByKey.values()) {
    const posQ = posByKey.get(key(userId, volumeId));
    if (posQ === undefined) drifts.push({ userId, volumeId, kind: "MISSING", positionQuantity: null, acquisitionsSum: sum });
    else if (posQ !== sum) drifts.push({ userId, volumeId, kind: "MISMATCH", positionQuantity: posQ, acquisitionsSum: sum });
  }
  // Posiciones SIN adquisiciones con cantidad ≠ 0.
  for (const p of positions) {
    if (!sumByKey.has(key(p.userId, p.volumeId)) && p.quantity !== 0)
      drifts.push({ userId: p.userId, volumeId: p.volumeId, kind: "ORPHAN_NONZERO", positionQuantity: p.quantity, acquisitionsSum: 0 });
  }

  drifts.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : a.volumeId - b.volumeId));
  return drifts;
}

/**
 * Repara UN par: recomputa `Σ Acquisition` DENTRO de la tx, tras tomar el lock de la posición, y la fija a esa
 * suma. Idempotente. Devuelve la cantidad resultante. No borra ni inventa adquisiciones.
 */
export function repairOwnershipPair(client: Client, userId: string, volumeId: number): Promise<number> {
  return dbRetry(() =>
    client.$transaction(async (tx) => {
      await tx.ownershipPosition.createMany({ data: [{ userId, volumeId, quantity: 0 }], skipDuplicates: true }); // asegura la fila
      await tx.$queryRaw`SELECT id FROM "OwnershipPosition" WHERE "userId" = ${userId} AND "volumeId" = ${volumeId} FOR UPDATE`; // lock ANTES de sumar
      const rows = await tx.$queryRaw<Array<{ sum: number }>>`SELECT COALESCE(SUM(quantity), 0)::int AS sum FROM "Acquisition" WHERE "userId" = ${userId} AND "volumeId" = ${volumeId}`;
      const sum = rows[0]?.sum ?? 0;
      await tx.ownershipPosition.update({ where: { userId_volumeId: { userId, volumeId } }, data: { quantity: sum } });
      return sum;
    }),
  );
}

/**
 * Audita y, si `repair`, repara cada par en orden determinista (cada uno en su propia tx con recompute+lock).
 * Sin `repair`, no modifica nada.
 */
export async function auditOwnership(client: Client, opts: { repair?: boolean } = {}): Promise<{ drifts: OwnershipDrift[]; repaired: number }> {
  const drifts = await detectOwnershipDrift(client);
  let repaired = 0;
  if (opts.repair) {
    for (const d of drifts) {
      await repairOwnershipPair(client, d.userId, d.volumeId);
      repaired++;
    }
  }
  return { drifts, repaired };
}
