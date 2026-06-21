import { prisma } from "@/lib/prisma";

export interface IntegrityItem {
  label: string; // qué mostrar
  detail?: string; // contexto para decidir
  editionId?: number; // si está, se puede Borrar la edición
  workId?: number; // si está, se puede "Marcar próxima" (debut válido sin tomos)
  url?: string; // link a la fuente para verificar
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
 * Anomalías ACCIONABLES del catálogo: ediciones a revisar desde
 * /admin/herramientas. Cada item trae el contexto y las acciones posibles.
 */
export async function getCatalogIntegrity(): Promise<IntegrityCheck[]> {
  const [zeroRaw, pubRows] = await Promise.all([
    // Ediciones con 0 tomos. Excluimos las de obras ya marcadas "próxima"
    // (debuts legítimos sin tomos): esas NO molestan, no van a la lista.
    prisma.publisherEdition.findMany({
      where: { volumes: 0 },
      select: {
        id: true,
        title: true,
        publisher: true,
        slug: true,
        url: true,
        workId: true,
        work: {
          select: { upcoming: true, editions: { select: { volumes: true } } },
        },
      },
      orderBy: { publisher: "asc" },
    }),
    // Duplicados: misma editorial + mismo normTitle (edición repetida).
    prisma.publisherEdition.findMany({
      select: {
        id: true,
        publisher: true,
        normTitle: true,
        title: true,
        slug: true,
        url: true,
        volumes: true,
        anilistId: true,
      },
    }),
  ]);

  const zeroVol = zeroRaw.filter((r) => !r.work?.upcoming);

  // Duplicados por (publisher, normTitle). Real solo si NO son series distintas
  // con nombre parecido (ej. "Citrus" vs "Citrus+" → distinto anilistId).
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
      hint: "Una serie nueva/anunciada sin tomos: marcala como Próxima (queda como debut). Si es basura del crawl o redundante: borrala. Las que ya son 'próxima' no aparecen.",
      count: zeroVol.length,
      samples: zeroVol.slice(0, CAP).map((r) => {
        const siblingMax = Math.max(0, ...(r.work?.editions.map((e) => e.volumes) ?? [0]));
        return {
          label: `${r.title} · ${r.publisher}`,
          detail:
            siblingMax > 0
              ? `${r.slug} · la obra ya tiene otra edición con ${siblingMax} tomos → redundante`
              : r.slug,
          editionId: r.id,
          workId: r.workId ?? undefined,
          url: r.url,
        };
      }),
    },
    {
      key: "dupes",
      title: "Ediciones duplicadas (misma editorial + título)",
      hint: "Misma serie cargada dos veces en la misma editorial. Borrá la repetida (a nivel EDICIÓN; los Works duplicados van en Series duplicadas).",
      count: dupGroups.length,
      samples: dupGroups.slice(0, CAP).flatMap((g) =>
        g.map((r) => ({
          label: `${r.title} · ${r.publisher}`,
          detail: `${r.slug} · ${r.volumes}t · grupo de ${g.length}`,
          editionId: r.id,
          url: r.url,
        })),
      ),
    },
  ];
}
