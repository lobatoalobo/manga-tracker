/**
 * Backfill de `Work.readingLinks` (lectores LEGALES: MANGA Plus, VIZ…) desde
 * AniList (links `type: STREAMING`). Sin AniList en runtime — esto es batch.
 * Solo para works con `anilistId` (de ahí que sea "algunas series"). El botón
 * "Leer en MangaDex" NO se guarda acá: se deriva del `mdId` en la ficha.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/reading-links.ts [--limit N] [--force]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { getMangaCore } from "../lib/getMangaDetails";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const limit = Number(arg("--limit")) || 100000;
  const force = process.argv.includes("--force");

  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: {
        type: { not: "COMIC" },
        anilistId: { not: null },
        editions: { some: {} },
      },
      select: { id: true, title: true, anilistId: true, readingLinks: true },
      take: limit,
      orderBy: { id: "asc" },
    }),
  );
  // Json-null se filtra acá (evita el typing de JsonNullableFilter): saltamos las
  // que ya tienen readingLinks salvo --force.
  const pending = force ? works : works.filter((w) => w.readingLinks == null);
  console.log(`Works con anilistId: ${works.length}, a procesar: ${pending.length}`);

  let withLinks = 0, none = 0, failed = 0;
  for (const w of pending) {
    const d = await getMangaCore(w.anilistId!).catch(() => null);
    if (!d) { failed++; await sleep(700); continue; }
    const links = d.readingLinks ?? [];
    if (links.length) {
      await dbRetry(() => prisma.work.update({ where: { id: w.id }, data: { readingLinks: links as unknown as Prisma.InputJsonValue } }));
      withLinks++;
      if (withLinks <= 25) console.log(`  ✓ #${w.id} "${w.title}" → ${links.map((l: { site: string }) => l.site).join(", ")}`);
    } else {
      // Guardamos array vacío para no re-consultar (salvo --force).
      await dbRetry(() => prisma.work.update({ where: { id: w.id }, data: { readingLinks: [] } }));
      none++;
    }
    await sleep(700);
  }
  console.log(`\nListo: con links ${withLinks}, sin links ${none}, fallidas ${failed} (de ${works.length})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
