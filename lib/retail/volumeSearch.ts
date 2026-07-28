/**
 * Infra de Retail — búsqueda server-side de TOMOS reales del catálogo para el picker de ofertas (§15).
 * Reutiliza la normalización del catálogo; NO crea matching difuso ni parser. Devuelve `volumeId` real +
 * datos para el snapshot. Paginado/limitado (no carga miles de volúmenes al cliente).
 */
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { normalizeTitle } from "@/lib/catalog";

export interface OfferVolumeCandidate {
  volumeId: number;
  title: string; // Work.title (o el de la edición si falta)
  volumeNumber: number;
  publisher: string;
  isbn: string | null;
}

/** Busca tomos cuyo Work/edición matchea `q` (título). Máximo `limit`. */
export async function searchOfferVolumes(q: string, limit = 20, client: Pick<PrismaClient, "volume"> = prisma): Promise<OfferVolumeCandidate[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await client.volume.findMany({
    where: {
      edition: {
        work: {
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { normTitle: { contains: normalizeTitle(term) } },
          ],
        },
      },
    },
    orderBy: [{ edition: { normTitle: "asc" } }, { number: "asc" }],
    take: limit,
    select: { id: true, number: true, isbn: true, edition: { select: { title: true, publisher: true, work: { select: { title: true } } } } },
  });
  return rows.map((v) => ({
    volumeId: v.id,
    title: v.edition.work?.title ?? v.edition.title,
    volumeNumber: v.number,
    publisher: v.edition.publisher,
    isbn: v.isbn,
  }));
}
