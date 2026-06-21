import { prisma } from "@/lib/prisma";

export interface IntegrityItem {
  label: string; // qué mostrar
  detail?: string; // contexto
  editionId?: number; // si está, se puede Borrar la edición desde la UI
}

export interface IntegrityCheck {
  key: string;
  title: string;
  hint: string;
  count: number;
  samples: IntegrityItem[]; // lista completa (cap alto) para poder accionar
}

const CAP = 500;

/**
 * Anomalías ACCIONABLES del catálogo: ediciones que conviene revisar/borrar a
 * mano desde /admin/herramientas. Cada item trae `editionId` para borrarla.
 * (Los chequeos de solo-lectura / redundantes con tareas se sacaron.)
 */
export async function getCatalogIntegrity(): Promise<IntegrityCheck[]> {
  const [zeroVol, pubRows] = await Promise.all([
    // Ediciones con 0 tomos → no se muestran como card (invisibles): basura del
    // crawl a borrar, o serie real sin conteo (se llena en el próximo crawl).
    prisma.publisherEdition.findMany({
      where: { volumes: 0 },
      select: { id: true, title: true, publisher: true, slug: true },
      orderBy: { publisher: "asc" },
    }),
    // Duplicados: misma editorial + mismo normTitle (edición repetida).
    prisma.publisherEdition.findMany({
      select: { id: true, publisher: true, normTitle: true, title: true, slug: true, volumes: true, anilistId: true },
    }),
  ]);

  // Agrupar duplicados por (publisher, normTitle). Duplicado real solo si NO son
  // series distintas con nombre parecido (ej. "Citrus" vs "Citrus+" normalizan
  // igual pero son 2 obras → distinto anilistId).
  const byKey = new Map<string, typeof pubRows>();
  for (const r of pubRows) {
    const k = `${r.publisher}::${r.normTitle}`;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }
  const dupGroups = [...byKey.values()].filter((g) => {
    if (g.length < 2) return false;
    const series = new Set(g.filter((r) => r.anilistId != null).map((r) => r.anilistId));
    return series.size < 2;
  });

  return [
    {
      key: "zeroVol",
      title: "Ediciones con 0 tomos",
      hint: "No se muestran como card (invisibles). Borrá las que son basura del crawl; las reales se llenan en el próximo crawl/enrich.",
      count: zeroVol.length,
      samples: zeroVol.slice(0, CAP).map((r) => ({
        label: `${r.title} · ${r.publisher}`,
        detail: r.slug,
        editionId: r.id,
      })),
    },
    {
      key: "dupes",
      title: "Ediciones duplicadas (misma editorial + título)",
      hint: "Misma serie cargada dos veces en la misma editorial. Borrá la repetida (ojo: a nivel EDICIÓN; los Works duplicados van en Series duplicadas).",
      count: dupGroups.length,
      samples: dupGroups.slice(0, CAP).flatMap((g) =>
        g.map((r) => ({
          label: `${r.title} · ${r.publisher}`,
          detail: `${r.slug} · ${r.volumes}t · grupo de ${g.length}`,
          editionId: r.id,
        })),
      ),
    },
  ];
}
