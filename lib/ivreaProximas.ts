import { prisma } from "@/lib/prisma";
import { getIvreaProximas, type IvreaProxima } from "@/lib/providers/ivrea";

export interface ProximasResult {
  cards: number; // tarjetas totales en /proximas/
  snapshot: number; // filas guardadas en IvreaRelease
  mapped: number; // de esas, cuántas mapean a una edición de Ivrea (por slug)
  reissues: number; // tarjetas de "REEDICIONES POR TOMO AGOTADO"
  debutWorks: number; // works con chip "próximo a salir"
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
 *  2) Reconcilia el chip `Work.upcoming` ("🔜 Próximo a salir") = DEBUT con ficha
 *     y fecha futura. Apaga el resto (limpia chips viejos de cualquier editorial).
 *     Los debuts reales suelen linkear a /news/ (slug=null) → pendientes de
 *     mapear por título.
 */
export async function reconcileIvreaProximas(
  dryRun = false,
): Promise<ProximasResult> {
  const cards = await getIvreaProximas();
  const today = new Date().toISOString().slice(0, 10);

  // Mapa slug → edición de Ivrea (editionId, anilistId).
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

  // Chip: debut con ficha (slug) y fecha futura → su work.
  const debutWorkIds = [
    ...new Set(
      cards
        .filter(
          (c) =>
            c.isNewSeries &&
            c.slug != null &&
            c.releaseDate != null &&
            c.releaseDate > today,
        )
        .map((c) => bySlug.get(c.slug as string)?.workId)
        .filter((id): id is number => id != null),
    ),
  ];

  const stale = await prisma.work.count({
    where: { upcoming: true, id: { notIn: debutWorkIds } },
  });

  if (!dryRun) {
    await prisma.$transaction([
      prisma.ivreaRelease.deleteMany({}),
      prisma.ivreaRelease.createMany({ data: rows }),
    ]);
    await prisma.work.updateMany({
      where: { upcoming: true, id: { notIn: debutWorkIds } },
      data: { upcoming: false },
    });
    if (debutWorkIds.length)
      await prisma.work.updateMany({
        where: { id: { in: debutWorkIds }, upcoming: false },
        data: { upcoming: true },
      });
  }

  return {
    cards: cards.length,
    snapshot: rows.length,
    mapped: rows.filter((r) => r.editionId != null).length,
    reissues: cards.filter((c) => c.isReissue).length,
    debutWorks: debutWorkIds.length,
    clearedStale: stale,
  };
}
