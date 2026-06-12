import { prisma } from "@/lib/prisma";
import { ovniSearchUrl, isOvniUrl } from "@/lib/ovni";

/** Override de búsqueda de Crumb para una serie (o null si no hay). */
export async function getCrumbQuery(anilistId: number): Promise<string | null> {
  const row = await prisma.crumbMapping.findUnique({ where: { anilistId } });
  return row?.query ?? null;
}

export async function setCrumbQuery(anilistId: number, query: string) {
  const q = query.trim();
  if (!q) {
    await prisma.crumbMapping.deleteMany({ where: { anilistId } });
    return;
  }
  await prisma.crumbMapping.upsert({
    where: { anilistId },
    create: { anilistId, query: q },
    update: { query: q },
  });
}

/**
 * Título por defecto para buscar en Crumb: el de la edición nacional mapeada
 * con más tomos (Crumb lista con el título de la editorial). Null si la serie
 * no tiene edición nacional mapeada.
 */
export async function crumbDefaultTitle(
  anilistId: number,
): Promise<string | null> {
  const mapped = await prisma.publisherEdition.findFirst({
    where: { anilistId },
    select: { title: true },
    orderBy: { volumes: "desc" },
  });
  return mapped?.title ?? null;
}

export interface OvniEditionLink {
  id: number;
  title: string;
  url: string; // link al sitio de Ovni (búsqueda o producto exacto)
}

/** La edición de Ovni mapeada a la serie, con su link a OvniPress (o null). */
export async function getOvniEditionForSeries(
  anilistId: number,
): Promise<OvniEditionLink | null> {
  const row = await prisma.publisherEdition.findFirst({
    where: { anilistId, publisher: "Ovni Press" },
    orderBy: { volumes: "desc" },
    select: { id: true, title: true, url: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    url: isOvniUrl(row.url) ? row.url : ovniSearchUrl(row.title),
  };
}

export async function setOvniUrl(editionId: number, url: string) {
  await prisma.publisherEdition.updateMany({
    where: { id: editionId, publisher: "Ovni Press" },
    data: { url: url.trim() },
  });
}
