import { prisma } from "@/lib/prisma";
import { getCollectionItems } from "@/lib/collection";
import { displayTitle } from "@/lib/title";
import { crumbSearch } from "@/lib/crumb";
import { laRevisteriaSearch } from "@/lib/larevisteria";
import { isOvniUrl, ovniSearchUrl } from "@/lib/ovni";

export interface ShoppingItem {
  anilistId: number;
  title: string;
  coverImage: string;
  publisher: string; // etiqueta de la edición trackeada
  owned: number;
  total: number;
  missing: number[]; // tomos que faltan (1..total sin los que tenés)
  // Retailers que venden todas las editoriales (búsqueda por título):
  crumbUrl: string;
  laRevisteriaUrl: string;
  // Sitio de la editorial solo cuando vende directo (Ovni). Ivrea/Panini no.
  ovniUrl: string | null;
}

/** Conteo liviano para el badge/bar: series incompletas y tomos faltantes (AR). */
export async function getShoppingCount(
  userId: string,
): Promise<{ series: number; tomos: number }> {
  const eds = await prisma.trackedEdition.findMany({
    where: { region: "AR", totalVolumes: { gt: 0 }, manga: { userId } },
    select: { totalVolumes: true, _count: { select: { ownedVolumes: true } } },
  });
  let series = 0;
  let tomos = 0;
  for (const e of eds) {
    const miss = e.totalVolumes - e._count.ownedVolumes;
    if (miss > 0) {
      series++;
      tomos += miss;
    }
  }
  return { series, tomos };
}

/**
 * Lista de compra: por cada edición nacional (AR) incompleta de la colección,
 * qué tomos faltan + a dónde comprarlos (Crumb + sitio de la editorial).
 */
export async function getShoppingList(userId: string): Promise<ShoppingItem[]> {
  const items = await getCollectionItems(userId);
  const incomplete = items.filter(
    (i) =>
      i.edition.region === "AR" &&
      i.edition.totalVolumes > 0 &&
      i.edition.ownedVolumes.length < i.edition.totalVolumes,
  );
  if (incomplete.length === 0) return [];

  const ids = [...new Set(incomplete.map((i) => i.anilistId))];
  const [crumbRows, pubRows] = await Promise.all([
    prisma.crumbMapping.findMany({ where: { anilistId: { in: ids } } }),
    prisma.publisherEdition.findMany({
      where: { anilistId: { in: ids } },
      select: {
        anilistId: true,
        publisher: true,
        title: true,
        url: true,
        volumes: true,
      },
    }),
  ]);
  const crumbBy = new Map(crumbRows.map((r) => [r.anilistId, r.query]));
  const pubBy = new Map<number, typeof pubRows>();
  for (const r of pubRows) {
    if (r.anilistId == null) continue;
    const arr = pubBy.get(r.anilistId) ?? [];
    arr.push(r);
    pubBy.set(r.anilistId, arr);
  }

  return incomplete
    .map((i): ShoppingItem => {
      const total = i.edition.totalVolumes;
      const owned = new Set(i.edition.ownedVolumes);
      const missing: number[] = [];
      for (let v = 1; v <= total; v++) if (!owned.has(v)) missing.push(v);

      const pubs = pubBy.get(i.anilistId) ?? [];
      // Link directo solo para Ovni (Ivrea/Panini no venden por su sitio).
      const ovni = pubs.find((p) => p.publisher === "Ovni Press");
      const ovniUrl = ovni
        ? isOvniUrl(ovni.url)
          ? ovni.url
          : ovniSearchUrl(ovni.title)
        : null;
      // Término de búsqueda para los retailers: override de Crumb, o el título
      // de la editorial con más tomos, o el romaji.
      const bestTitle = [...pubs].sort((a, b) => b.volumes - a.volumes)[0]?.title;
      const query = crumbBy.get(i.anilistId) ?? bestTitle ?? i.title.romaji;

      return {
        anilistId: i.anilistId,
        title: displayTitle(i.title),
        coverImage: i.coverImage,
        publisher: i.edition.label,
        owned: i.edition.ownedVolumes.length,
        total,
        missing,
        crumbUrl: crumbSearch(query),
        laRevisteriaUrl: laRevisteriaSearch(query),
        ovniUrl,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
