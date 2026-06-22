/**
 * Recupera portadas de obras SIN portada que tienen una edición de Whakoom
 * (Panini/Ovni/españolas con título solo en español, que no matchean MU/MD). Baja
 * la portada (og:image) de la página de Whakoom y la guarda en R2. Idempotente,
 * resumible y con dbRetry (ver memoria maintenance-tooling-robust).
 *
 * Corré LOCAL (Whakoom bloquea datacenter):
 *   node scripts/with-prod.mjs npx tsx scripts/whakoom-covers.ts [--limit N] [--dry]
 */
import { prisma } from "../lib/prisma";
import { getWhakoomEdition } from "../lib/providers/whakoom";
import { storeCover } from "../lib/coverStore";
import { dbRetry } from "../lib/dbRetry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function whakoomUrl(url: string | null, whakoomId: string | null): string | null {
  if (url && /whakoom\.com\/ediciones\//i.test(url)) return url;
  if (whakoomId) return `https://www.whakoom.com/ediciones/${whakoomId}/_`;
  return null;
}

async function main() {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const limit = Number(arg("--limit")) || 300;
  const dry = process.argv.includes("--dry");

  // Una edición de Whakoom por obra sin portada (la primera con whakoomId/url).
  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: {
        work: { coverImage: null },
        OR: [{ whakoomId: { not: null } }, { url: { contains: "whakoom.com/ediciones/" } }],
      },
      select: { workId: true, whakoomId: true, url: true, work: { select: { title: true } } },
      orderBy: { workId: "asc" },
    }),
  );
  // dedupe por obra
  const byWork = new Map<number, (typeof eds)[number]>();
  for (const e of eds) if (e.workId != null && !byWork.has(e.workId)) byWork.set(e.workId, e);
  const targets = [...byWork.values()].slice(0, limit);
  console.log(`${targets.length} obras sin portada con edición de Whakoom…\n`);

  let ok = 0;
  let fail = 0;
  for (const e of targets) {
    const url = whakoomUrl(e.url, e.whakoomId);
    if (!url) {
      fail++;
      continue;
    }
    const ed = await getWhakoomEdition(url).catch(() => null);
    const raw = ed?.cover ?? null;
    const cover = raw ? ((await storeCover(raw)) ?? raw) : null;
    if (cover && !dry) {
      await dbRetry(() =>
        prisma.work.update({ where: { id: e.workId! }, data: { coverImage: cover } }),
      ).catch(() => {});
      ok++;
      if (ok <= 25) console.log(`  ✓ ${e.work?.title}`);
    } else if (cover) {
      ok++;
    } else {
      fail++;
      if (fail <= 15) console.log(`  ✗ ${e.work?.title} — sin portada en Whakoom`);
    }
    await sleep(700);
  }

  console.log(`\n${dry ? "[DRY] " : ""}recuperadas ${ok} · sin portada ${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
