import { prisma } from "@/lib/prisma";

export const PUBLISHERS = [
  "Ivrea Argentina",
  "Panini Argentina",
  "Ovni Press",
] as const;

export interface IndexedEdition {
  publisher: string;
  slug: string;
  title: string;
  volumes: number;
  status: string | null;
  url: string;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyTitle(value: string): string {
  return normalizeTitle(value).replace(/ /g, "-");
}

/**
 * Busca en el índice las mejores ediciones (una por editorial) que matcheen
 * cualquiera de los títulos dados. Match exacto por slug o título normalizado.
 */
export async function lookupEditions(
  titles: string[],
): Promise<IndexedEdition[]> {
  const slugs = titles.map(slugifyTitle);
  const norms = titles.map(normalizeTitle);

  const rows = await prisma.publisherEdition.findMany({
    where: {
      OR: [{ slug: { in: slugs } }, { normTitle: { in: norms } }],
    },
  });

  // Una por editorial: si hay varias, la de más tomos (edición más completa).
  const best = new Map<string, IndexedEdition>();
  for (const r of rows) {
    const cur = best.get(r.publisher);
    if (!cur || r.volumes > cur.volumes) {
      best.set(r.publisher, {
        publisher: r.publisher,
        slug: r.slug,
        title: r.title,
        volumes: r.volumes,
        status: r.status,
        url: r.url,
      });
    }
  }
  return [...best.values()];
}

interface TitledMedia {
  id: number;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
}

/**
 * De una lista de series (resultados de AniList), cuáles tienen edición nacional
 * según el índice de editoriales (match por título normalizado). Devuelve, por
 * id de serie, las editoriales que la publican. Una sola query indexada.
 *
 * Nota: el match es por título, así que puede haber algún falso positivo en
 * títulos homónimos (mismo nombre, distinto autor). Para un badge es aceptable.
 */
export async function nationalEditionsByManga(
  mangas: TitledMedia[],
): Promise<Map<number, string[]>> {
  const byNorm = new Map<string, number[]>(); // normTitle -> ids de series
  for (const m of mangas) {
    for (const t of [m.title.romaji, m.title.english]) {
      const n = t ? normalizeTitle(t) : "";
      if (!n) continue;
      const ids = byNorm.get(n) ?? [];
      if (!ids.includes(m.id)) ids.push(m.id);
      byNorm.set(n, ids);
    }
  }

  const result = new Map<number, string[]>();
  const norms = [...byNorm.keys()];
  if (norms.length === 0) return result;

  const rows = await prisma.publisherEdition.findMany({
    where: { normTitle: { in: norms } },
    select: { normTitle: true, publisher: true },
  });

  for (const r of rows) {
    for (const id of byNorm.get(r.normTitle) ?? []) {
      const pubs = result.get(id) ?? [];
      if (!pubs.includes(r.publisher)) pubs.push(r.publisher);
      result.set(id, pubs);
    }
  }
  return result;
}

export async function upsertPublisherEdition(e: {
  publisher: string;
  slug: string;
  title: string;
  volumes: number;
  status?: string | null;
  url: string;
}): Promise<void> {
  await prisma.publisherEdition.upsert({
    where: { publisher_slug: { publisher: e.publisher, slug: e.slug } },
    update: {
      title: e.title,
      normTitle: normalizeTitle(e.title),
      volumes: e.volumes,
      status: e.status ?? null,
      url: e.url,
    },
    create: {
      publisher: e.publisher,
      slug: e.slug,
      title: e.title,
      normTitle: normalizeTitle(e.title),
      volumes: e.volumes,
      status: e.status ?? null,
      url: e.url,
    },
  });
}
