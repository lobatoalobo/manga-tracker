/**
 * Rellena `Work.author` desde Whakoom para las ediciones ya importadas cuyo Work
 * quedó sin autor (el import viejo no lo guardaba). El autor habilita el match
 * por autor del botón "Auto" / auto-map, clave para editoriales sin sitio propio
 * (Utopía) y títulos en español que no matchean por título exacto.
 *
 *   npx tsx scripts/backfill-work-authors.ts [utopia|kemuri|…]        # dry-run
 *   npx tsx scripts/backfill-work-authors.ts utopia --apply
 *
 * Corré local: Whakoom suele bloquear al server de Vercel. Lento (1 fetch por
 * obra, con throttle).
 */
import { prisma } from "../lib/prisma";
import { getWhakoomEdition } from "../lib/providers/whakoom";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PUB: Record<string, string> = {
  ivrea: "Ivrea Argentina",
  panini: "Panini Argentina",
  ovni: "Ovni Press",
  kemuri: "Kemuri Ediciones",
  utopia: "Utopía Editorial",
  larp: "Larp Editores",
  distrito: "Distrito Manga",
  planeta: "Planeta Cómic",
};

async function main() {
  const args = process.argv.slice(2);
  const apply = args.some((a) => a === "--apply" || a === "apply");
  const pubArg = args.find((a) => a in PUB);
  const publisher = pubArg ? PUB[pubArg] : undefined;

  const rows = await prisma.publisherEdition.findMany({
    where: {
      url: { contains: "whakoom" },
      workId: { not: null },
      work: { author: null },
      ...(publisher ? { publisher } : {}),
    },
    select: { id: true, title: true, url: true, workId: true, publisher: true },
    orderBy: { publisher: "asc" },
  });
  console.log(`Works sin autor (con link Whakoom): ${rows.length}`);

  let done = 0;
  let miss = 0;
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.workId!)) continue;
    seen.add(r.workId!);

    const ed = await getWhakoomEdition(r.url).catch(() => null);
    await sleep(500);
    const author = ed?.author?.trim();
    if (!author) {
      miss++;
      continue;
    }
    console.log(`#${r.workId} [${r.publisher}] "${r.title}" → ${author}`);
    if (apply)
      await prisma.work
        .update({ where: { id: r.workId! }, data: { author } })
        .catch(() => {});
    done++;
  }

  console.log(
    `\n${done} works con autor${apply ? " (aplicado)" : ""}; ${miss} sin autor en Whakoom.`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
