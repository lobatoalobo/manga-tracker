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

export interface SeriesEditionLink {
  id: number;
  publisher: string;
  title: string;
  url: string; // link guardado (editable por admin)
}

/** Todas las ediciones mapeadas a la serie, con su link de tienda editable. */
export async function getEditionsForSeries(
  anilistId: number,
): Promise<SeriesEditionLink[]> {
  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId },
    orderBy: [{ publisher: "asc" }, { volumes: "desc" }],
    select: { id: true, publisher: true, title: true, url: true },
  });
  return rows.map((r) => ({
    id: r.id,
    publisher: r.publisher,
    title: r.title,
    // Para Ovni, si la URL no es de OvniPress, mostramos la búsqueda como base.
    url:
      r.publisher === "Ovni Press" && !isOvniUrl(r.url)
        ? ovniSearchUrl(r.title)
        : r.url,
  }));
}

/** Editoriales desvinculadas a mano de la serie (para poder re-vincularlas). */
export async function getExcludedPublishers(
  anilistId: number,
): Promise<string[]> {
  const rows = await prisma.editionExclusion.findMany({
    where: { anilistId },
    select: { publisher: true },
  });
  return rows.map((r) => r.publisher);
}

/** Corrige el link de tienda de una edición (cualquier editorial). */
export async function setEditionUrl(editionId: number, url: string) {
  await prisma.publisherEdition.updateMany({
    where: { id: editionId },
    data: { url: url.trim() },
  });
}
