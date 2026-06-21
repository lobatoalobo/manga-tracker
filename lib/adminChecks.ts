import { prisma } from "@/lib/prisma";
import { isOvniUrl } from "@/lib/ovni";

export interface IntegrityItem {
  label: string; // qué mostrar
  detail?: string; // contexto
  href?: string; // a dónde ir a arreglarlo
}

export interface IntegrityCheck {
  key: string;
  title: string;
  hint: string;
  count: number;
  samples: IntegrityItem[]; // primeros N
}

const SAMPLE = 12;

/**
 * Anomalías queryables del catálogo y las colecciones. Cada chequeo apunta a un
 * incidente que ya tuvimos, para poder corregirlo a mano desde admin.
 */
export async function getCatalogIntegrity(): Promise<IntegrityCheck[]> {
  const [zeroVol, ovniBadUrl, trackedEds, pubRows] = await Promise.all([
    // 1) Ediciones con 0 tomos → no se muestran como card (invisibles).
    prisma.publisherEdition.findMany({
      where: { volumes: 0 },
      select: { id: true, title: true, publisher: true, anilistId: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    // 2) Ovni sin link a OvniPress (debería ser 0 tras el backfill).
    prisma.publisherEdition.findMany({
      where: { publisher: "Ovni Press" },
      select: { id: true, title: true, url: true, anilistId: true },
    }),
    // 3) Tomo poseído > total de la edición (el bug del tomo 15).
    prisma.trackedEdition.findMany({
      where: { ownedVolumes: { some: {} } },
      select: {
        id: true,
        label: true,
        totalVolumes: true,
        manga: { select: { anilistId: true, romajiTitle: true } },
        ownedVolumes: { select: { volume: true } },
      },
    }),
    // 4) Posibles duplicados: misma editorial + mismo normTitle.
    prisma.publisherEdition.findMany({
      select: {
        id: true,
        publisher: true,
        normTitle: true,
        title: true,
        anilistId: true,
      },
    }),
  ]);

  // 3) filtrar en memoria los que tienen un tomo fuera de rango.
  const outOfRange = trackedEds
    .map((e) => ({
      e,
      max: Math.max(...e.ownedVolumes.map((v) => v.volume), 0),
    }))
    .filter((x) => x.e.totalVolumes > 0 && x.max > x.e.totalVolumes);

  // 4) agrupar duplicados por (publisher, normTitle).
  const byKey = new Map<string, typeof pubRows>();
  for (const r of pubRows) {
    const k = `${r.publisher}::${r.normTitle}`;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }
  // Duplicado real solo si NO son series distintas con nombre parecido (ej.
  // "Citrus" #97832 vs "Citrus+" #103884 normalizan igual pero son 2 obras).
  const dupes = [...byKey.values()].filter((g) => {
    if (g.length < 2) return false;
    const series = new Set(
      g.filter((r) => r.anilistId != null).map((r) => r.anilistId),
    );
    return series.size < 2;
  });

  const ovniBad = ovniBadUrl.filter((r) => !isOvniUrl(r.url));

  return [
    {
      key: "zeroVol",
      title: "Ediciones con 0 tomos",
      hint: "No se muestran como card en la ficha; revisá o borrá.",
      count: zeroVol.length,
      samples: zeroVol.slice(0, SAMPLE).map((r) => ({
        label: `${r.title} · ${r.publisher}`,
        detail: r.anilistId ? `serie #${r.anilistId}` : "sin mapear",
        href: r.anilistId ? `/manga/${r.anilistId}` : undefined,
      })),
    },
    {
      key: "outOfRange",
      title: "Tomos fuera de rango (poseído > total)",
      hint: "El total cacheado quedó corto; ampliar total o revisar.",
      count: outOfRange.length,
      samples: outOfRange.slice(0, SAMPLE).map(({ e, max }) => ({
        label: `${e.manga.romajiTitle} · ${e.label}`,
        detail: `tomo ${max} > total ${e.totalVolumes}`,
        href: `/manga/${e.manga.anilistId}`,
      })),
    },
    {
      key: "ovniBadUrl",
      title: "Ovni sin link a OvniPress",
      hint: "URL todavía apunta a Whakoom u otra fuente.",
      count: ovniBad.length,
      samples: ovniBad.slice(0, SAMPLE).map((r) => ({
        label: r.title,
        detail: r.url,
        href: r.anilistId ? `/manga/${r.anilistId}` : undefined,
      })),
    },
    {
      key: "dupes",
      title: "Posibles duplicados (misma editorial + título)",
      hint: "Pueden ser ediciones repetidas; consolidá o borrá.",
      count: dupes.length,
      samples: dupes.slice(0, SAMPLE).map((g) => ({
        label: `${g[0].title} · ${g[0].publisher}`,
        detail: `${g.length} entradas`,
      })),
    },
  ];
}
