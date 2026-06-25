/**
 * Fusiona los Works partidos por idioma (mismo romaji + autor, sin id externo
 * compartido) que detecta `scan-romaji-dups.ts`. Elige un target canónico
 * (nacional > anilistId > muId > mdId > #ediciones > id más bajo), fusiona el
 * resto con `mergeWorks` (preserva data de usuario + identidad externa) y limpia
 * ediciones redundantes SOLO si son del mismo publisher con los MISMOS tomos
 * (protege ediciones distintas reales, ej. Hellsing regular 10t vs Inmortal 5t).
 *
 * SEGURIDAD: saltea grupos con >1 anilistId distinto (posible serie/mapeo aparte)
 * y un blocklist de falsos positivos por datos malos (Shaman King Zero≠Flowers,
 * Yu-Gi-Oh base≠Arc-V).
 *
 *   node scripts/with-prod.mjs npx tsx scripts/merge-romaji-dups.ts          # dry
 *   node scripts/with-prod.mjs npx tsx scripts/merge-romaji-dups.ts --apply
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { romajiKey, authorNameMatches } from "../lib/catalog";
import { mergeWorks } from "../lib/mergeWorks";

const NATIONAL = new Set(["Ivrea Argentina", "Panini Argentina", "Ovni Press", "Distrito Manga"]);
// Falsos positivos por datos malos (romajiKey colapsa series distintas).
const BLOCK = new Set(["shaman king zero", "yu gi oh"]);

type W = {
  id: number; title: string; originalTitle: string | null; author: string | null;
  anilistId: number | null; muId: string | null; mdId: string | null;
  editions: { id: number; publisher: string; slug: string; volumes: number; anilistId: number | null }[];
  _collection?: number;
};

function score(w: W): number[] {
  const hasNat = w.editions.some((e) => NATIONAL.has(e.publisher)) ? 1 : 0;
  return [hasNat, w.anilistId ? 1 : 0, w.muId ? 1 : 0, w.mdId ? 1 : 0, w.editions.length, -w.id];
}
const better = (a: number[], b: number[]) => a.some((v, i) => v !== b[i] && v > b[i] && a.slice(0, i).every((x, j) => x === b[j]));

async function main() {
  const apply = process.argv.includes("--apply");
  const works = (await dbRetry(() =>
    prisma.work.findMany({
      where: { originalTitle: { not: null } },
      select: {
        id: true, title: true, originalTitle: true, author: true, anilistId: true, muId: true, mdId: true,
        editions: { select: { id: true, publisher: true, slug: true, volumes: true, anilistId: true } },
      },
    }),
  )) as W[];

  const byKey = new Map<string, W[]>();
  for (const w of works) {
    const k = romajiKey(w.originalTitle!);
    if (k.length < 4) continue;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(w);
  }

  let merged = 0, edsDeleted = 0, skipped = 0;
  for (const [k, ws] of byKey) {
    if (ws.length < 2) continue;
    const group = ws.filter((a, i) => ws.some((b, j) => i !== j && authorNameMatches(a.author ?? "", b.author)));
    if (group.length < 2) continue;

    const als = [...new Set(group.map((w) => w.anilistId).filter((x): x is number => x != null))];
    if (BLOCK.has(k) || als.length > 1) {
      console.log(`\n⏭️  SKIP [${k}] (${BLOCK.has(k) ? "blocklist" : "anilistId distinto"})`);
      group.forEach((w) => console.log(`     #${w.id} "${w.title}" AL=${w.anilistId ?? "—"}`));
      skipped++;
      continue;
    }

    // Target = mejor score; sources = el resto.
    let target = group[0];
    for (const w of group) if (better(score(w), score(target))) target = w;
    const sources = group.filter((w) => w.id !== target.id);

    console.log(`\n[${k}]  target → #${target.id} "${target.title}"`);
    for (const s of sources) {
      const col = await dbRetry(() => prisma.manga.count({ where: { anilistId: -s.id } }));
      console.log(`   merge #${s.id} "${s.title}"${col ? `  (⚠️ ${col} en colección, se re-clavan)` : ""}`);
      if (apply) await mergeWorks(s.id, target.id);
      merged++;
    }

    // Dedup de ediciones redundantes del target: mismo publisher + MISMOS tomos.
    const eds = apply
      ? await dbRetry(() => prisma.publisherEdition.findMany({
          where: { workId: target.id }, select: { id: true, publisher: true, slug: true, volumes: true, anilistId: true } }))
      : [...target.editions, ...sources.flatMap((s) => s.editions)];
    const buckets = new Map<string, typeof eds>();
    for (const e of eds) (buckets.get(`${e.publisher}::${e.volumes}`) ?? buckets.set(`${e.publisher}::${e.volumes}`, []).get(`${e.publisher}::${e.volumes}`)!).push(e);
    for (const [bk, bucket] of buckets) {
      if (bucket.length < 2) continue;
      const keep = [...bucket].sort((a, b) => (b.anilistId ? 1 : 0) - (a.anilistId ? 1 : 0) || a.slug.length - b.slug.length)[0];
      for (const e of bucket) {
        if (e.id === keep.id) continue;
        console.log(`     ✂️  edición redundante: ${e.publisher}/${e.slug}(${e.volumes}t)  [keep ${keep.slug}]`);
        if (apply) await prisma.publisherEdition.delete({ where: { id: e.id } }).catch(() => {});
        edsDeleted++;
      }
    }
  }

  console.log(`\n=== ${apply ? "APLICADO" : "DRY"}: ${merged} works fusionados, ${edsDeleted} ediciones redundantes borradas, ${skipped} grupos salteados ===`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
