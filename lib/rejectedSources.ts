import { prisma } from "@/lib/prisma";

export type RejectSource = "whakoom" | "ivrea";

interface RejectRow {
  source: RejectSource;
  sourceId: string;
  reason?: string;
}

/**
 * Marca fuentes (whakoomId / slug de Ivrea) como descartadas: el crawl/import
 * no las vuelve a traer. Idempotente.
 */
export async function rejectSources(rows: RejectRow[]): Promise<void> {
  for (const r of rows) {
    if (!r.sourceId) continue;
    await prisma.rejectedSource
      .upsert({
        where: { source_sourceId: { source: r.source, sourceId: r.sourceId } },
        create: { source: r.source, sourceId: r.sourceId, reason: r.reason ?? null },
        update: r.reason ? { reason: r.reason } : {},
      })
      .catch(() => {});
  }
}

/**
 * Registra como descartadas las fuentes de las ediciones dadas ANTES de
 * borrarlas, para que el crawl no las re-importe. Ivrea → su slug; el resto
 * (importadas de Whakoom) → su whakoomId.
 */
export async function rejectEditions(
  editionIds: number[],
  reason = "borrada en admin",
): Promise<void> {
  if (!editionIds.length) return;
  const eds = await prisma.publisherEdition.findMany({
    where: { id: { in: editionIds } },
    select: { publisher: true, slug: true, whakoomId: true },
  });
  const rows: RejectRow[] = [];
  for (const e of eds) {
    if (e.whakoomId) rows.push({ source: "whakoom", sourceId: e.whakoomId, reason });
    if (e.publisher === "Ivrea Argentina")
      rows.push({ source: "ivrea", sourceId: e.slug, reason });
  }
  await rejectSources(rows);
}

/** Set de sourceIds descartados de una fuente (para saltear en el import/crawl). */
export async function getRejected(source: RejectSource): Promise<Set<string>> {
  const rows = await prisma.rejectedSource.findMany({
    where: { source },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId));
}

/** Extrae el id de Whakoom de una URL /ediciones/<id>/… */
export function whakoomIdFromUrl(url: string): string | null {
  return url.match(/\/ediciones\/(\d+)\//)?.[1] ?? null;
}
