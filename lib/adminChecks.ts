import { prisma } from "@/lib/prisma";

export interface IntegrityItem {
  label: string; // qué mostrar
  detail?: string; // contexto para decidir
  editionId?: number; // si está, se puede Borrar la edición
  workId?: number; // si está, se puede "Marcar próxima" (debut válido sin tomos)
  url?: string; // link a la fuente para verificar
  serieHref?: string; // link a la ficha en la app (/serie/<id>) para ver qué es
}

export interface IntegrityCheck {
  key: string;
  title: string;
  hint: string;
  count: number;
  samples: IntegrityItem[]; // lista completa (cap alto) para poder accionar
}

const CAP = 500;

export interface MissingCoverItem {
  workId: number;
  title: string;
  detail: string; // editoriales, para dar contexto
  serieHref: string; // /serie/<id> para ver/verificar
}

/**
 * Series VISIBLES sin portada (coverImage null y con al menos una edición, así
 * no listamos works huérfanos). Para arreglarlas rápido desde /admin/herramientas
 * subiendo un archivo o pegando una URL (ambos van a R2). Ver covers-r2.
 */
export async function getWorksMissingCover(): Promise<MissingCoverItem[]> {
  const works = await prisma.work.findMany({
    where: { coverImage: null, editions: { some: {} } },
    select: {
      id: true,
      title: true,
      editions: { select: { publisher: true } },
    },
    orderBy: { title: "asc" },
  });
  return works.map((w) => ({
    workId: w.id,
    title: w.title,
    detail: [...new Set(w.editions.map((e) => e.publisher))].join(" · "),
    serieHref: `/serie/${w.id}`,
  }));
}

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
        workId: true,
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
          serieHref: r.workId ? `/serie/${r.workId}` : undefined,
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
          serieHref: r.workId ? `/serie/${r.workId}` : undefined,
        })),
      ),
    },
  ];
}
