import { prisma } from "@/lib/prisma";
import { dbRetry } from "@/lib/dbRetry";

/**
 * Unificación de autores. El autor es texto libre en `Work.author` (no hay tabla
 * de autores), así que el mismo mangaka aparece con grafías distintas: orden
 * (nombre-apellido vs apellido-nombre) y mayúsculas ("Inio Asano" vs "ASANO Inio"
 * vs "INIO ASANO"). Detectamos las variantes por set de tokens y las reescribimos
 * a una forma canónica. Ver memoria mangaka-index / edition-author-verification.
 */

export interface AuthorVariantCluster {
  key: string; // tokens ordenados (identidad del autor)
  total: number; // obras totales que lo mencionan
  variants: { name: string; count: number }[]; // grafías, de más a menos usada
  suggested: string; // canónico sugerido: la más usada, en Title Case
}

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

/** Identidad de un autor: tokens ordenados (insensible a orden y mayúsculas). */
export function authorKey(name: string): string {
  return [...tokens(name)].sort().join(" ");
}

/** Separa un string de autores en nombres individuales. */
export function splitAuthors(field: string): string[] {
  return field
    .split(/,|&| y /i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Reescribe un campo de autor: cada nombre cuyo lowercase esté en `set` se
 * reemplaza por `canonical`, preservando co-autores y deduplicando. Devuelve null
 * si no cambió nada (ningún nombre matcheó o el resultado es idéntico).
 */
export function rewriteAuthorField(
  field: string,
  set: Set<string>,
  canonical: string,
): string | null {
  const names = splitAuthors(field);
  let touched = false;
  const mapped = names.map((n) => {
    if (set.has(n.toLowerCase())) {
      touched = true;
      return canonical;
    }
    return n;
  });
  if (!touched) return null;
  const result = [...new Set(mapped)].join(", ");
  return result === field ? null : result;
}

/**
 * Clusters de autores con ≥2 grafías distintas (mismo set de tokens). Cola de
 * revisión para unificar. Ordenados por cuántas obras involucran.
 */
export async function getAuthorVariantClusters(): Promise<AuthorVariantCluster[]> {
  const works = await dbRetry(() =>
    prisma.work.findMany({ where: { author: { not: null } }, select: { author: true } }),
  );
  const clusters = new Map<string, Map<string, number>>();
  for (const w of works) {
    for (const name of splitAuthors(w.author ?? "")) {
      if (tokens(name).length < 2) continue; // 1 token no sufre el problema de orden
      const key = authorKey(name);
      const m = clusters.get(key) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + 1);
      clusters.set(key, m);
    }
  }
  const out: AuthorVariantCluster[] = [];
  for (const [key, m] of clusters) {
    if (m.size < 2) continue; // una sola grafía = no hay nada que unificar
    const variants = [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    out.push({
      key,
      total: variants.reduce((s, v) => s + v.count, 0),
      variants,
      suggested: titleCase(variants[0].name),
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

export interface RenameAuthorReport {
  changed: number; // obras actualizadas
  canonical: string;
}

/**
 * Reescribe `Work.author` en todas las obras: cada nombre que matchee una de las
 * `variants` (case-insensitive) se reemplaza por `canonical`, preservando los
 * co-autores. Marca el campo como `curated` para que ningún job lo vuelva a pisar.
 */
export async function renameAuthor(
  variants: string[],
  canonical: string,
): Promise<RenameAuthorReport> {
  const to = canonical.trim();
  if (!to) throw new Error("El nombre canónico no puede estar vacío");
  const set = new Set(variants.map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (set.size === 0) throw new Error("No hay variantes a unificar");

  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { author: { not: null } },
      select: { id: true, author: true, anilistId: true, curated: true },
    }),
  );

  let changed = 0;
  for (const w of works) {
    const newAuthor = rewriteAuthorField(w.author ?? "", set, to);
    if (newAuthor == null) continue;

    const curated = new Set(w.curated ?? []);
    curated.add("author");
    await dbRetry(() =>
      prisma.work.update({
        where: { id: w.id },
        data: { author: newAuthor, curated: [...curated] },
      }),
    );
    changed++;
  }
  return { changed, canonical: to };
}
