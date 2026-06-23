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

export interface MissingSynopsisItem {
  workId: number;
  title: string;
  serieHref: string;
  es: string | null;
  en: string | null;
  esAuto: boolean;
  enAuto: boolean;
}

const SYN_CAP = 400;

/**
 * Series VISIBLES a las que les falta AL MENOS una versión de sinopsis (ES o EN).
 * Para completarlas desde /admin/sinopsis: si una está, se traduce a la otra; si
 * faltan las dos, carga manual. Las que tienen las dos no aparecen. Prioriza las
 * que tienen al menos una (se pueden traducir) — orden: una presente primero.
 */
export async function getWorksMissingSynopsis(): Promise<MissingSynopsisItem[]> {
  const works = await prisma.work.findMany({
    where: { editions: { some: {} }, OR: [{ synopsisEs: null }, { synopsisEn: null }] },
    select: {
      id: true,
      title: true,
      synopsisEs: true,
      synopsisEn: true,
      synopsisEsAuto: true,
      synopsisEnAuto: true,
    },
    orderBy: { title: "asc" },
  });
  // Las que tienen una versión (traducibles) primero; después las que no tienen ninguna.
  works.sort((a, b) => {
    const ha = a.synopsisEs || a.synopsisEn ? 0 : 1;
    const hb = b.synopsisEs || b.synopsisEn ? 0 : 1;
    return ha - hb;
  });
  return works.slice(0, SYN_CAP).map((w) => ({
    workId: w.id,
    title: w.title,
    serieHref: `/serie/${w.id}`,
    es: w.synopsisEs,
    en: w.synopsisEn,
    esAuto: w.synopsisEsAuto,
    enAuto: w.synopsisEnAuto,
  }));
}

/** Conteo liviano de series sin alguna versión de sinopsis (para el panel). */
export async function countWorksMissingSynopsis(): Promise<number> {
  return prisma.work.count({
    where: { editions: { some: {} }, OR: [{ synopsisEs: null }, { synopsisEn: null }] },
  });
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
  // Ediciones con 0 tomos. Excluimos las de obras ya marcadas "próxima" (debuts
  // legítimos sin tomos). Las "Ediciones duplicadas" se movieron a /admin/duplicados.
  const zeroRaw = await prisma.publisherEdition.findMany({
    where: { volumes: 0 },
    select: {
      id: true,
      title: true,
      publisher: true,
      slug: true,
      url: true,
      workId: true,
      work: { select: { upcoming: true, editions: { select: { volumes: true } } } },
    },
    orderBy: { publisher: "asc" },
  });

  const zeroVol = zeroRaw.filter((r) => !r.work?.upcoming);

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
  ];
}
