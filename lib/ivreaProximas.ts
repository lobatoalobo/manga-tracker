import { prisma } from "@/lib/prisma";
import {
  getIvreaProximas,
  getIvreaNews,
  type IvreaProxima,
} from "@/lib/providers/ivrea";
import { findOrCreateWork } from "@/lib/catalog";

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

  // Mapa slug → edición de Ivrea (editionId, anilistId) para el snapshot.
  const slugs = [...new Set(cards.map((c) => c.slug).filter(Boolean))] as string[];
  const editions = slugs.length
    ? await prisma.publisherEdition.findMany({
        where: { publisher: "Ivrea Argentina", slug: { in: slugs } },
        select: { id: true, slug: true, anilistId: true, workId: true },
      })
    : [];
  const bySlug = new Map(editions.map((e) => [e.slug, e]));

  const rows = cards.map((c) => {
    const ed = c.slug ? bySlug.get(c.slug) : undefined;
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

  // Próximas series (debuts) desde /news/.
  const news = await getIvreaNews();
  const debutWorkIds: number[] = [];
  if (!dryRun) {
    for (const n of news) {
      const workId = await findOrCreateWork({
        title: n.title,
        coverImage: n.coverImage,
        author: n.author,
      }).catch(() => null);
      if (workId == null) continue;
      await prisma.work.update({
        where: { id: workId },
        data: { upcoming: true, releaseLabel: n.releaseLabel ?? undefined },
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
    newSeries: news.length,
    debutWorks: debutWorkIds.length,
    clearedStale: stale,
  };
}
