/**
 * Auditoría de integridad del catálogo (read-only). Escanea TODA la base
 * buscando los patrones de bug que ya nos pasaron, para detectarlos sin revisar
 * serie por serie. Cada check imprime conteo + muestra. Sale != 0 si hay algo
 * crítico (para usarlo como gate).
 *
 *   node scripts/with-staging.mjs npx tsx scripts/audit-catalog.ts   (staging)
 *   npx tsx scripts/audit-catalog.ts                                 (prod, .env)
 */
import { prisma } from "../lib/prisma";
import {
  VISIBLE_PUBLISHERS,
  INTL_PUBLISHERS,
  inCatalogWhere,
  tightTitleKey,
} from "../lib/catalog";

const VIS = [...VISIBLE_PUBLISHERS];
const VIZ = INTL_PUBLISHERS[0];

interface Check {
  name: string;
  detail: string;
  critical: boolean;
  run: () => Promise<{ count: number; samples: string[] }>;
}

const titles = (ws: { title: string }[]) => ws.slice(0, 8).map((w) => w.title);

const checks: Check[] = [
  {
    name: "no-tomos",
    detail: "obras visibles sin tomos publicados y sin 'próximo' (necesitan conteo o Work.type)",
    critical: false,
    run: async () => {
      // Se MUESTRAN (no se ocultan), pero conviene saber cuáles tienen 0 tomos
      // para conseguirles el conteo (crawl/enrich) o tiparlas (novela/artbook).
      const ws = await prisma.work.findMany({
        where: {
          AND: [
            inCatalogWhere(),
            { NOT: { editions: { some: { publisher: { in: VIS }, volumes: { gt: 0 } } } } },
            { upcoming: false },
          ],
        },
        select: { title: true },
      });
      return { count: ws.length, samples: titles(ws) };
    },
  },
  {
    name: "broken-cover",
    detail: "portadas rotas: URL de Vercel Blob viejo (403) o hotlink directo de MangaDex (bloqueado). El proxy /api/cover NO cuenta (es la solución).",
    critical: true,
    run: async () => {
      const ws = await prisma.work.findMany({
        where: {
          OR: [
            { coverImage: { contains: "blob.vercel-storage" } },
            { coverImage: { contains: "uploads.mangadex.org" } },
          ],
        },
        select: { title: true },
      });
      return { count: ws.length, samples: titles(ws) };
    },
  },
  {
    name: "viz-no-cover",
    detail: "obras VIZ sin portada (deberían rellenarse por MU/MD)",
    critical: false,
    run: async () => {
      const ws = await prisma.work.findMany({
        where: { coverImage: null, editions: { some: { publisher: VIZ } } },
        select: { title: true },
      });
      return { count: ws.length, samples: titles(ws) };
    },
  },
  {
    name: "viz-zero-vol",
    detail: "ediciones VIZ con 0 tomos (match a sub-entrada / cuenta rota)",
    critical: false,
    run: async () => {
      const eds = await prisma.publisherEdition.findMany({
        where: { publisher: VIZ, volumes: 0 },
        select: { title: true },
      });
      return { count: eds.length, samples: eds.slice(0, 8).map((e) => e.title) };
    },
  },
  {
    name: "stale-upcoming",
    detail: "obras con tomos publicados pero flag 'upcoming' viejo (chip 'próximo' incorrecto)",
    critical: false,
    run: async () => {
      const ws = await prisma.work.findMany({
        where: { upcoming: true, editions: { some: { volumes: { gt: 0 } } } },
        select: { title: true },
      });
      return { count: ws.length, samples: titles(ws) };
    },
  },
  {
    name: "dup-title",
    detail: "Works distintos con la MISMA llave estricta (duplicado real no unificado)",
    critical: false,
    run: async () => {
      // tightTitleKey distingue homónimos cercanos (Citrus vs Citrus+), así que
      // dos works con la misma llave estricta SÍ son un duplicado real.
      const ws = await prisma.work.findMany({
        where: { editions: { some: { publisher: { in: VIS } } } },
        select: { title: true },
      });
      const by = new Map<string, string[]>();
      for (const w of ws) {
        const k = tightTitleKey(w.title);
        const a = by.get(k) ?? [];
        a.push(w.title);
        by.set(k, a);
      }
      const dups = [...by.values()].filter((v) => v.length > 1);
      return { count: dups.length, samples: dups.slice(0, 8).map((v) => v.join(" = ")) };
    },
  },
  {
    name: "split-anilist",
    detail: "ediciones con el MISMO anilistId en Works distintos (dup no unificado, ej. Devilman G/Grimoire) → fusionar con scripts/merge-works.ts",
    critical: false,
    run: async () => {
      // El anilistId de la edición se resuelve a veces DESPUÉS de crear el Work
      // (por título), y no reconcilia. Si dos ediciones comparten anilistId pero
      // cuelgan de Works distintos, son la misma serie partida. El de título no lo
      // agarra (títulos distintos: "Devilman G" vs "Devilman Grimoire").
      const eds = await prisma.publisherEdition.findMany({
        where: { anilistId: { not: null }, workId: { not: null } },
        select: { anilistId: true, workId: true, work: { select: { title: true } } },
      });
      const byAnilist = new Map<number, Map<number, string>>();
      for (const e of eds) {
        const m = byAnilist.get(e.anilistId!) ?? new Map<number, string>();
        m.set(e.workId!, e.work?.title ?? `#${e.workId}`);
        byAnilist.set(e.anilistId!, m);
      }
      const split = [...byAnilist.entries()].filter(([, works]) => works.size > 1);
      return {
        count: split.length,
        samples: split.slice(0, 8).map(([aid, works]) =>
          `anilist ${aid}: ${[...works.entries()].map(([id, t]) => `#${id} ${t}`).join(" = ")}`,
        ),
      };
    },
  },
  {
    name: "wishlist-orphan",
    detail: "deseados por edición cuya editorial no existe en la obra",
    critical: false,
    run: async () => {
      const wl = await prisma.wishlistItem.findMany({
        where: { editionKey: { not: "" }, publisher: { not: null }, anilistId: { lt: 0 } },
        select: { title: true, anilistId: true, publisher: true },
      });
      const bad: string[] = [];
      for (const w of wl) {
        const has = await prisma.publisherEdition.count({
          where: { workId: -w.anilistId, publisher: w.publisher! },
        });
        if (has === 0) bad.push(`${w.title} (${w.publisher})`);
      }
      return { count: bad.length, samples: bad.slice(0, 8) };
    },
  },
];

(async () => {
  console.log("=== Auditoría del catálogo ===\n");
  let criticalHits = 0;
  for (const c of checks) {
    const r = await c.run().catch((e) => ({ count: -1, samples: [String(e)] }));
    const flag = r.count === 0 ? "✓" : c.critical ? "✗ CRÍTICO" : "⚠";
    console.log(`${flag} ${c.name}: ${r.count}  — ${c.detail}`);
    if (r.count > 0) {
      for (const s of r.samples) console.log(`     · ${s}`);
      if (c.critical) criticalHits += r.count;
    }
  }
  console.log(
    criticalHits > 0
      ? `\n✗ ${criticalHits} problema(s) crítico(s).`
      : "\n✓ Sin problemas críticos.",
  );
  process.exit(criticalHits > 0 ? 1 : 0);
})();
