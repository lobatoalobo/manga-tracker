import { prisma } from "@/lib/prisma";
import { getIvreaProximas } from "@/lib/providers/ivrea";

export interface ProximasResult {
  cards: number; // tarjetas totales en /proximas/
  newSeries: number; // marcadas "¡NUEVA SERIE!"
  debutWorks: number; // works que quedan con chip "próximo a salir"
  clearedStale: number; // works que tenían el chip y se apagaron
}

/**
 * Reconcilia el flag `Work.upcoming` ("🔜 Próximo a salir") usando como ÚNICA
 * fuente de verdad la página de próximas salidas de Ivrea.
 *
 * Por decisión de producto, hoy SOLO Ivrea alimenta este sistema (el resto de
 * las editoriales son inconsistentes). El chip = serie que TODAVÍA NO SALIÓ:
 * tarjeta marcada "¡NUEVA SERIE!" Y cuya edición de Ivrea aún tiene 0 tomos en
 * nuestro catálogo. Ojo: "¡NUEVA SERIE!" sola no alcanza — Ivrea deja en
 * /proximas/ series nuevas cuyo tomo 1 YA está a la venta (esas no son "próximo
 * a salir"). Un próximo tomo de una serie publicada (One Piece #109) tampoco.
 *
 * Es idempotente y auto-limpiante: deja `upcoming=true` exactamente en los
 * debuts no publicados de Ivrea, y apaga el flag en todo el resto (incluye los
 * chips viejos que quedaron prendidos de cualquier editorial).
 */
export async function reconcileIvreaProximas(
  dryRun = false,
): Promise<ProximasResult> {
  const cards = await getIvreaProximas();
  const debutSlugs = cards.filter((c) => c.isNewSeries).map((c) => c.slug);

  const editions = debutSlugs.length
    ? await prisma.publisherEdition.findMany({
        where: { publisher: "Ivrea Argentina", slug: { in: debutSlugs } },
        select: { workId: true, volumes: true },
      })
    : [];

  const debutWorkIds = [
    ...new Set(
      editions
        // Solo las que todavía no tienen tomos publicados (no salió aún).
        .filter((e) => e.workId != null && e.volumes === 0)
        .map((e) => e.workId as number),
    ),
  ];

  const stale = await prisma.work.count({
    where: { upcoming: true, id: { notIn: debutWorkIds } },
  });

  if (!dryRun) {
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
    newSeries: debutSlugs.length,
    debutWorks: debutWorkIds.length,
    clearedStale: stale,
  };
}
