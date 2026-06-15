import { prisma } from "@/lib/prisma";
import { tightTitleKey, findOrCreateWork } from "@/lib/catalog";
import { looksLikeComic } from "@/lib/comicTerms";

/**
 * Lógica de curación del catálogo, compartida por los scripts de terminal y las
 * tareas admin (dry-run/apply). Todo es solo-DB (no toca Whakoom/Ivrea), así que
 * corre igual en Vercel. Cada función devuelve un resumen estilo TaskResult.
 */
export interface CurationResult {
  scanned: number;
  changed: number;
  samples: string[];
  note?: string;
}

const SAMPLE = 20;
const isWhakoom = (u: string) => /whakoom\.com/i.test(u);

async function cleanOrphanWorks(): Promise<number> {
  const r = await prisma.work.deleteMany({ where: { editions: { none: {} } } });
  return r.count;
}

// --- Cómics -----------------------------------------------------------------

export async function flagComics(dryRun: boolean): Promise<CurationResult> {
  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: null },
    select: { id: true, publisher: true, title: true },
  });
  const hits = rows
    .map((r) => ({ ...r, term: looksLikeComic(r.title) }))
    .filter((h): h is typeof h & { term: string } => !!h.term);

  let orphans = 0;
  if (!dryRun && hits.length) {
    await prisma.publisherEdition.deleteMany({ where: { id: { in: hits.map((h) => h.id) } } });
    orphans = await cleanOrphanWorks();
  }
  return {
    scanned: rows.length,
    changed: hits.length,
    samples: hits.slice(0, SAMPLE).map((h) => `#${h.id} [${h.publisher}] "${h.title}" (${h.term})`),
    note: orphans ? `${orphans} works huérfanos borrados` : undefined,
  };
}

// --- Depuración: 1 edición regular por (obra, editorial) --------------------

const SPECIAL =
  /especial|deluxe|kanzenban|kanzen|coleccionista|aniversario|integral|omnibus|ómnibus|absolute|variante|limitada|maximum|gold|box\b/i;

interface DepRow {
  id: number;
  workId: number | null;
  anilistId: number | null;
  publisher: string;
  title: string;
  volumes: number;
  whakoomId: string | null;
}

function depRank(a: DepRow, b: DepRow): number {
  if (b.volumes !== a.volumes) return b.volumes - a.volumes;
  const aw = a.whakoomId ? 1 : 0;
  const bw = b.whakoomId ? 1 : 0;
  if (bw !== aw) return bw - aw;
  return a.id - b.id;
}

function safeToCollapse(keep: DepRow, drop: DepRow): boolean {
  if (tightTitleKey(keep.title) === tightTitleKey(drop.title)) return true;
  if (SPECIAL.test(drop.title) && !SPECIAL.test(keep.title)) return true;
  return false;
}

export async function depurateCatalog(dryRun: boolean): Promise<CurationResult> {
  const rows: DepRow[] = await prisma.publisherEdition.findMany({
    select: {
      id: true, workId: true, anilistId: true, publisher: true,
      title: true, volumes: true, whakoomId: true,
    },
  });
  const groups = new Map<string, DepRow[]>();
  for (const r of rows) {
    const series =
      r.anilistId != null ? `a${r.anilistId}` : r.workId != null ? `w${r.workId}` : null;
    if (!series) continue;
    (groups.get(`${r.publisher}|${series}`) ?? groups.set(`${r.publisher}|${series}`, []).get(`${r.publisher}|${series}`)!).push(r);
  }

  const toDelete: number[] = [];
  const samples: string[] = [];
  let flagged = 0;
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    list.sort(depRank);
    const keep = list[0];
    for (const drop of list.slice(1)) {
      if (safeToCollapse(keep, drop)) {
        toDelete.push(drop.id);
        if (samples.length < SAMPLE)
          samples.push(`borra #${drop.id} "${drop.title}" (${drop.volumes}t) → queda "${keep.title}" (${keep.volumes}t)`);
      } else {
        flagged++;
      }
    }
  }

  let orphans = 0;
  if (!dryRun && toDelete.length) {
    await prisma.publisherEdition.deleteMany({ where: { id: { in: toDelete } } });
    orphans = await cleanOrphanWorks();
  } else if (!dryRun) {
    orphans = await cleanOrphanWorks();
  }
  return {
    scanned: rows.length,
    changed: toDelete.length,
    samples,
    note: `${flagged} a revisar (homónimos)${orphans ? ` · ${orphans} huérfanos` : ""}`,
  };
}

// --- Consolidar duplicados (misma editorial + título + tomos) ---------------

interface ConRow {
  id: number;
  publisher: string;
  title: string;
  volumes: number;
  anilistId: number | null;
  whakoomId: string | null;
  url: string;
}

export async function consolidateDups(dryRun: boolean): Promise<CurationResult> {
  const rows: ConRow[] = await prisma.publisherEdition.findMany({
    select: {
      id: true, publisher: true, title: true, volumes: true,
      anilistId: true, whakoomId: true, url: true,
    },
  });
  const groups = new Map<string, ConRow[]>();
  for (const r of rows) {
    const key = `${r.publisher}|${tightTitleKey(r.title)}|${r.volumes}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  let changed = 0;
  const samples: string[] = [];
  const cachesToFlush = new Set<number>();
  for (const [, grp] of groups) {
    if (grp.length < 2) continue;
    grp.sort((a, b) => {
      const am = a.anilistId ? 1 : 0, bm = b.anilistId ? 1 : 0;
      if (am !== bm) return bm - am;
      const ar = isWhakoom(a.url) ? 0 : 1, br = isWhakoom(b.url) ? 0 : 1;
      if (ar !== br) return br - ar;
      return a.id - b.id;
    });
    const keep = grp[0];
    const rest = grp.slice(1);
    const patch: { anilistId?: number; url?: string; whakoomId?: string } = {};
    if (!keep.anilistId) {
      const m = rest.find((r) => r.anilistId);
      if (m?.anilistId) patch.anilistId = m.anilistId;
    }
    if (isWhakoom(keep.url)) {
      const real = rest.find((r) => !isWhakoom(r.url));
      if (real) patch.url = real.url;
    }
    if (!keep.whakoomId) {
      const w = rest.find((r) => r.whakoomId);
      if (w?.whakoomId) patch.whakoomId = w.whakoomId;
    }
    if (samples.length < SAMPLE)
      samples.push(`queda #${keep.id} "${keep.title}" (${keep.volumes}t)${patch.url ? " +url-real" : ""} → borra ${rest.map((r) => `#${r.id}`).join(", ")}`);
    if (!dryRun) {
      await prisma.publisherEdition.deleteMany({ where: { id: { in: rest.map((r) => r.id) } } });
      if (Object.keys(patch).length)
        await prisma.publisherEdition.update({ where: { id: keep.id }, data: patch }).catch(() => {});
    }
    if (keep.anilistId) cachesToFlush.add(keep.anilistId);
    if (patch.anilistId) cachesToFlush.add(patch.anilistId);
    changed += rest.length;
  }

  let orphans = 0;
  if (!dryRun) {
    orphans = await cleanOrphanWorks();
    if (cachesToFlush.size)
      await prisma.editionsCache.deleteMany({ where: { anilistId: { in: [...cachesToFlush] } } });
  }
  return {
    scanned: rows.length,
    changed,
    samples,
    note: orphans ? `${orphans} works huérfanos borrados` : undefined,
  };
}

// --- Separar homónimos fusionados (Citrus / Citrus+) ------------------------

export async function splitHomonyms(dryRun: boolean): Promise<CurationResult> {
  const works = await prisma.work.findMany({
    select: {
      id: true, title: true,
      editions: { select: { id: true, title: true, anilistId: true } },
    },
  });
  let moved = 0;
  const samples: string[] = [];
  for (const w of works) {
    if (w.editions.length < 2) continue;
    const anchor = tightTitleKey(w.title);
    for (const e of w.editions) {
      if (e.anilistId != null) continue;
      if (tightTitleKey(e.title) === anchor) continue;
      if (samples.length < SAMPLE)
        samples.push(`#${e.id} "${e.title}" sale del work "${w.title}"`);
      if (!dryRun) {
        const newId = await findOrCreateWork({ title: e.title, anilistId: null }).catch(() => null);
        if (newId && newId !== w.id) {
          await prisma.publisherEdition.update({ where: { id: e.id }, data: { workId: newId } });
          moved++;
        }
      } else {
        moved++;
      }
    }
  }
  let orphans = 0;
  if (!dryRun) orphans = await cleanOrphanWorks();
  return {
    scanned: works.length,
    changed: moved,
    samples,
    note: orphans ? `${orphans} works huérfanos borrados` : undefined,
  };
}
