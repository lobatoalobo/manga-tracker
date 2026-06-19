import { prisma } from "@/lib/prisma";
import {
  getIvreaProximas,
  getIvreaNews,
  type IvreaProxima,
} from "@/lib/providers/ivrea";
import { findOrCreateWork, normalizeTitle } from "@/lib/catalog";

export interface ProximasResult {
  cards: number; // tarjetas totales en /proximas/
  snapshot: number; // filas guardadas en IvreaRelease
  mapped: number; // de esas, cuántas mapean a una edición de Ivrea (por slug)
  reissues: number; // tarjetas de "REEDICIONES POR TOMO AGOTADO"
  newSeries: number; // próximas series (debuts) sembradas desde /news/
  debutWorks: number; // works con chip "próximo a salir" (= newSeries)
  clearedStale: number; // works que tenían el chip y se apagaron
}

function kindOf(c: IvreaProxima): string {
  if (c.isReissue) return "reissue";
  if (c.isOneShot) return "oneshot";
  if (c.isNewSeries) return "debut";
  return "volume";
}

/**
 * Refresca todo lo que sale de la página de próximas salidas de Ivrea (única
 * fuente del sistema de próximos por ahora):
 *
 *  1) Snapshot en `IvreaRelease` de TODAS las tarjetas (lanzamiento/debut/tomo
 *     único/reedición) con su fecha, mapeadas a la edición de Ivrea por slug
 *     cuando existe. Reemplazo total (la página es el estado actual).
 *  2) Siembra las PRÓXIMAS SERIES (debuts) desde /news/ como `Work` con
 *     `upcoming=true` + `releaseLabel` (todavía sin edición; cuando salgan, el
 *     crawl les engancha la edición por título). Esas son el set de "próximo a
 *     salir"; el resto se apaga (limpia chips viejos de cualquier editorial).
 */
export async function reconcileIvreaProximas(
  dryRun = false,
): Promise<ProximasResult> {
  const cards = await getIvreaProximas();

  // Mapa de ediciones de Ivrea por slug y por título normalizado. El slug del
  // link de /proximas/ a veces es genérico (ej. la reedición "BLEACH REMIX"
  // linkea a /titulo/bleach/ → slug "bleach", la edición equivocada), así que
  // cuando el TÍTULO de la tarjeta matchea exactamente UNA sola edición, esa gana.
  const editions = await prisma.publisherEdition.findMany({
    where: { publisher: "Ivrea Argentina" },
    select: { id: true, slug: true, title: true, anilistId: true, workId: true },
  });
  const bySlug = new Map(editions.map((e) => [e.slug, e]));
  const byNormTitle = new Map<string, typeof editions>();
  for (const e of editions) {
    const k = normalizeTitle(e.title);
    const arr = byNormTitle.get(k) ?? [];
    arr.push(e);
    byNormTitle.set(k, arr);
  }

  const rows = cards.map((c) => {
    const slugEd = c.slug ? bySlug.get(c.slug) : undefined;
    const titleMatch = byNormTitle.get(normalizeTitle(c.title)) ?? [];
    // Título inequívoco (1 sola edición) tiene prioridad sobre el slug del link.
    const ed = titleMatch.length === 1 ? titleMatch[0] : slugEd;
    return {
      slug: c.slug,
      title: c.title,
      volume: c.volume,
      kind: kindOf(c),
      releaseDate: c.releaseDate ? new Date(c.releaseDate) : null,
      editionId: ed?.id ?? null,
      anilistId: ed?.anilistId ?? null,
    };
  });

  // Próximas SERIES (debuts) = tarjetas de /proximas/ marcadas ¡NUEVA SERIE! o
  // ¡TOMO ÚNICO! (título+portada+fecha limpios, incluye "Historias con aroma de
  // café") UNIDAS con las de /news/ (que aportan autor). Merge por título norm.
  const today = new Date().toISOString().slice(0, 10);
  const news = await getIvreaNews();
  type Debut = { title: string; cover: string | null; releaseLabel: string | null; author: string | null; date: string | null };
  const debuts = new Map<string, Debut>();
  for (const c of cards) {
    if (!c.isNewSeries && !c.isOneShot) continue;
    const k = normalizeTitle(c.title);
    const rl = c.releaseDate ? c.releaseDate.slice(0, 7) : null;
    const ex = debuts.get(k);
    if (ex) {
      if (!ex.cover) ex.cover = c.coverImage;
      if (!ex.releaseLabel) ex.releaseLabel = rl;
      if (!ex.date) ex.date = c.releaseDate;
    } else {
      debuts.set(k, { title: c.title, cover: c.coverImage, releaseLabel: rl, author: null, date: c.releaseDate });
    }
  }
  for (const n of news) {
    const k = normalizeTitle(n.title);
    const ex = debuts.get(k);
    if (ex) {
      if (!ex.cover) ex.cover = n.coverImage;
      if (!ex.author) ex.author = n.author;
      if (!ex.releaseLabel) ex.releaseLabel = n.releaseLabel;
    } else {
      debuts.set(k, { title: n.title, cover: n.coverImage, releaseLabel: n.releaseLabel, author: n.author, date: null });
    }
  }

  const debutWorkIds: number[] = [];
  if (!dryRun) {
    for (const d of debuts.values()) {
      const workId = await findOrCreateWork({
        title: d.title,
        coverImage: d.cover,
        author: d.author,
      }).catch(() => null);
      if (workId == null) continue;
      // "Próxima serie" = anunciada pero TODAVÍA NO PUBLICADA. Ya salió si:
      //  - tiene edición con tomos (volumes>0), o
      //  - su fecha exacta de /proximas/ ya pasó (caso Marriage Toxin: salió pero
      //    Ivrea todavía no la pasó a /catalogo/, así que no hay edición aún), o
      //  - su mes anunciado es anterior al actual.
      // En cualquiera de esos casos NO es upcoming (queda false por el clear).
      const published = await prisma.publisherEdition.count({
        where: { workId, volumes: { gt: 0 } },
      });
      const datePast = d.date != null && d.date <= today;
      const monthPast = d.releaseLabel != null && d.releaseLabel < today.slice(0, 7);
      if (published > 0 || datePast || monthPast) continue;
      await prisma.work.update({
        where: { id: workId },
        data: { upcoming: true, releaseLabel: d.releaseLabel ?? undefined },
      });
      debutWorkIds.push(workId);
    }
  }

  const stale = await prisma.work.count({
    where: { upcoming: true, id: { notIn: debutWorkIds } },
  });

  if (!dryRun) {
    await prisma.$transaction([
      prisma.ivreaRelease.deleteMany({}),
      prisma.ivreaRelease.createMany({ data: rows }),
    ]);
    // Apagar upcoming en todo lo que no sea una próxima serie vigente.
    await prisma.work.updateMany({
      where: { upcoming: true, id: { notIn: debutWorkIds } },
      data: { upcoming: false },
    });
  }

  return {
    cards: cards.length,
    snapshot: rows.length,
    mapped: rows.filter((r) => r.editionId != null).length,
    reissues: cards.filter((c) => c.isReissue).length,
    newSeries: debuts.size,
    debutWorks: debutWorkIds.length,
    clearedStale: stale,
  };
}
