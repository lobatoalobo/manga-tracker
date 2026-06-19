import { prisma } from "@/lib/prisma";
import { getCollectionItems } from "@/lib/collection";
import { displayTitle } from "@/lib/title";
import { crumbSearch } from "@/lib/crumb";
import { laRevisteriaSearch } from "@/lib/larevisteria";
import { isOvniUrl, ovniSearchUrl } from "@/lib/ovni";

export interface WishlistBuyItem {
  anilistId: number;
  title: string;
  coverImage: string;
  publisher: string;
  total: number;
  crumbUrl: string;
}

/**
 * Series de DESEADOS que YA están disponibles en AR (tienen tomos publicados) →
 * "para comprar" (la serie entera). Local: anilistId negativo = -workId, miramos
 * sus ediciones; resto, por anilistId. Devuelve la edición con más tomos.
 */
export async function getWishlistToBuy(userId: string): Promise<WishlistBuyItem[]> {
  const wishes = await prisma.wishlistItem.findMany({
    where: { userId },
    select: { anilistId: true, title: true, coverImage: true },
  });
  if (wishes.length === 0) return [];

  // 1 sola query (antes era un findFirst por deseado = N+1). Traemos todas las
  // ediciones publicadas de los works/anilistIds deseados, ordenadas por tomos
  // desc, y nos quedamos con la de MÁS tomos por clave (la primera que aparece).
  const workIds = wishes.filter((w) => w.anilistId < 0).map((w) => -w.anilistId);
  const anilistIds = wishes.filter((w) => w.anilistId > 0).map((w) => w.anilistId);

  const eds = await prisma.publisherEdition.findMany({
    where: {
      volumes: { gt: 0 },
      OR: [
        ...(workIds.length ? [{ workId: { in: workIds } }] : []),
        ...(anilistIds.length ? [{ anilistId: { in: anilistIds } }] : []),
      ],
    },
    orderBy: { volumes: "desc" },
    select: {
      workId: true,
      anilistId: true,
      publisher: true,
      volumes: true,
      work: { select: { coverImage: true } },
    },
  });

  type Ed = (typeof eds)[number];
  const byWork = new Map<number, Ed>();
  const byAnilist = new Map<number, Ed>();
  for (const e of eds) {
    if (e.workId != null && !byWork.has(e.workId)) byWork.set(e.workId, e);
    if (e.anilistId != null && !byAnilist.has(e.anilistId)) byAnilist.set(e.anilistId, e);
  }

  const out: WishlistBuyItem[] = [];
  for (const w of wishes) {
    const ed = w.anilistId < 0 ? byWork.get(-w.anilistId) : byAnilist.get(w.anilistId);
    if (!ed) continue; // todavía no salió en AR
    out.push({
      anilistId: w.anilistId,
      title: w.title,
      coverImage: ed.work?.coverImage ?? w.coverImage,
      publisher: ed.publisher,
      total: ed.volumes,
      crumbUrl: crumbSearch(w.title),
    });
  }
  return out;
}

export interface ShoppingItem {
  anilistId: number;
  title: string;
  coverImage: string;
  publisher: string; // etiqueta de la edición trackeada
  owned: number;
  total: number;
  missing: number[]; // tomos que faltan (1..total sin los que tenés)
  reissues: { volume: number; date: string }[]; // tomos faltantes que se reeditan pronto
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
  const workIds = ids.filter((id) => id < 0).map((id) => -id);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const [crumbRows, pubRows, reissueByWork] = await Promise.all([
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
    reissuesByWork(workIds, today),
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

      // Reediciones próximas que cubren un tomo que te FALTA (accionable).
      const missingSet = new Set(missing);
      const reissues =
        i.anilistId < 0
          ? (reissueByWork.get(-i.anilistId) ?? []).filter(
              (r) => r.volume != null && missingSet.has(r.volume),
            )
          : [];

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
        reissues: reissues.map((r) => ({
          volume: r.volume as number,
          date: r.date.toISOString(),
        })),
        crumbUrl: crumbSearch(query),
        laRevisteriaUrl: laRevisteriaSearch(query),
        ovniUrl,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Reediciones próximas (kind=reissue, futuras) por workId, vía sus ediciones. */
async function reissuesByWork(
  workIds: number[],
  today: Date,
): Promise<Map<number, { volume: number | null; date: Date }[]>> {
  const out = new Map<number, { volume: number | null; date: Date }[]>();
  if (workIds.length === 0) return out;
  const eds = await prisma.publisherEdition.findMany({
    where: { workId: { in: workIds } },
    select: { id: true, workId: true },
  });
  const edToWork = new Map(eds.map((e) => [e.id, e.workId as number]));
  if (eds.length === 0) return out;
  const rr = await prisma.ivreaRelease.findMany({
    where: {
      editionId: { in: eds.map((e) => e.id) },
      kind: "reissue",
      releaseDate: { gte: today },
    },
    orderBy: { releaseDate: "asc" },
    select: { editionId: true, volume: true, releaseDate: true },
  });
  const seen = new Set<string>(); // dedup por work+tomo (la más cercana)
  for (const r of rr) {
    if (r.editionId == null || !r.releaseDate) continue;
    const wid = edToWork.get(r.editionId);
    if (wid == null) continue;
    const k = `${wid}:${r.volume}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const arr = out.get(wid) ?? [];
    arr.push({ volume: r.volume, date: r.releaseDate });
    out.set(wid, arr);
  }
  return out;
}
