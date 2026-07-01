/**
 * Rellena `Work.credits` (roles: STORY/ART/…) desde MangaUpdates, POR muId (fetch
 * liviano por id, no search). Manga con muId. Resumable (solo works sin credits),
 * throttled (cuida el rate/ban de MU), dry-run por default. Respeta `curated`.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/enrich-credits.ts               # dry-run
 *   node scripts/with-prod.mjs npx tsx scripts/enrich-credits.ts --execute --limit=50
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { getSeriesFull } from "../lib/providers/mangaupdates";
import { isCurated } from "../lib/domain/work/curated";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const execute = process.argv.includes("--execute");
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
  const delay = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1]) || 300;

  const all = await prisma.work.findMany({
    where: { type: { not: "COMIC" }, muId: { not: null } },
    select: { id: true, title: true, muId: true, curated: true, credits: true },
  });
  // Resumable: solo los que todavía no tienen credits (el filtro Json-null en Prisma
  // es poco fiable → filtramos en JS, ver fix de reading-links).
  const pending = all.filter((w) => w.credits == null).slice(0, limit);
  console.log(`Manga con muId sin credits: ${all.filter((w) => w.credits == null).length} · procesando ${pending.length}`);

  let done = 0, empty = 0, curatedSkip = 0, fail = 0;
  for (const w of pending) {
    if (isCurated(w.curated, "credits")) { curatedSkip++; continue; }
    const d = await getSeriesFull(Number(w.muId)).catch(() => null);
    await sleep(delay);
    if (!d) { fail++; continue; }
    if (!d.credits.length) { empty++; continue; }
    const credits = d.credits.map((c, i) => ({ ...c, order: i }));
    console.log(`#${w.id} «${w.title}»: ${credits.map((c) => `${c.name} [${c.role}]`).join(", ")}`);
    if (execute)
      await dbRetry(() =>
        prisma.work.update({
          where: { id: w.id },
          data: { credits: credits as unknown as Prisma.InputJsonValue },
        }),
      );
    done++;
  }

  console.log(`\n${execute ? "APLICADO" : "DRY-RUN"} · con roles ${done} · sin data ${empty} · curados ${curatedSkip} · fallos ${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
