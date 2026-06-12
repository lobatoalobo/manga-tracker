import { prisma } from "@/lib/prisma";
import { EDITORIALS } from "@/lib/catalog";

export interface PublisherCount {
  publisher: string;
  label: string;
  total: number;
  mapped: number;
  unmapped: number; // sin AniList y no marcadas como solo-nacional
  national: number; // solo-nacional (sin AniList a propósito)
}

export interface SuspiciousGroup {
  key: string;
  detail: string;
  items: { label: string; href: string }[];
}

export interface MappingHealth {
  publishers: PublisherCount[];
  // Mismo título → distintas series (riesgo de homónimo o mismap).
  homonyms: SuspiciousGroup[];
  // Misma editorial mapea 2+ entradas distintas a la misma serie (posible
  // spin-off mal mapeado, tipo "Attack on Titan: Before the Fall" → AoT).
  overmerges: SuspiciousGroup[];
}

const SAMPLE = 25;

export async function getMappingHealth(): Promise<MappingHealth> {
  const [counts, rows] = await Promise.all([
    Promise.all(
      EDITORIALS.map(async (e) => {
        const [total, mapped, national] = await Promise.all([
          prisma.publisherEdition.count({ where: { publisher: e.publisher } }),
          prisma.publisherEdition.count({
            where: { publisher: e.publisher, anilistId: { not: null } },
          }),
          prisma.publisherEdition.count({
            where: { publisher: e.publisher, nationalOnly: true },
          }),
        ]);
        return {
          publisher: e.publisher,
          label: e.label,
          total,
          mapped,
          national,
          unmapped: total - mapped - national,
        };
      }),
    ),
    prisma.publisherEdition.findMany({
      where: { anilistId: { not: null } },
      select: {
        publisher: true,
        slug: true,
        normTitle: true,
        title: true,
        anilistId: true,
      },
    }),
  ]);

  // Homónimos: mismo normTitle → distintos anilistId.
  const byTitle = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byTitle.get(r.normTitle) ?? [];
    arr.push(r);
    byTitle.set(r.normTitle, arr);
  }
  const homonyms: SuspiciousGroup[] = [];
  for (const [, group] of byTitle) {
    const ids = [...new Set(group.map((g) => g.anilistId))];
    if (ids.length > 1) {
      homonyms.push({
        key: group[0].title,
        detail: `${ids.length} series distintas`,
        items: ids.map((id) => ({
          label: `serie #${id}`,
          href: `/manga/${id}`,
        })),
      });
    }
  }

  // Over-merge: misma editorial, distintos slugs → mismo anilistId.
  const byPubId = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.publisher}::${r.anilistId}`;
    const arr = byPubId.get(k) ?? [];
    arr.push(r);
    byPubId.set(k, arr);
  }
  const overmerges: SuspiciousGroup[] = [];
  for (const [, group] of byPubId) {
    const slugs = [...new Set(group.map((g) => g.slug))];
    if (slugs.length > 1) {
      overmerges.push({
        key: `${group[0].publisher} → #${group[0].anilistId}`,
        detail: `${slugs.length} entradas`,
        items: group.map((g) => ({
          label: g.title,
          href: `/admin/mapeos?q=${encodeURIComponent(g.title)}`,
        })),
      });
    }
  }

  return {
    publishers: counts,
    homonyms: homonyms.slice(0, SAMPLE),
    overmerges: overmerges.slice(0, SAMPLE),
  };
}
