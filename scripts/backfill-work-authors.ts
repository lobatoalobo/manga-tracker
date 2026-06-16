/**
 * Rellena `Work.author` y `Work.synopsis` desde Whakoom para las ediciones ya
 * importadas cuyo Work quedó incompleto (el import viejo no los guardaba). El
 * autor habilita el match por autor del botón "Auto" / auto-map (clave para
 * editoriales sin sitio propio como Utopía); la sinopsis enriquece la ficha
 * nacional de las obras que no están en AniList.
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
      work: { OR: [{ author: null }, { synopsis: null }] },
      ...(publisher ? { publisher } : {}),
    },
    select: {
      id: true, title: true, url: true, workId: true, publisher: true,
      work: { select: { author: true, synopsis: true } },
    },
    orderBy: { publisher: "asc" },
  });
  console.log(`Works incompletos (con link Whakoom): ${rows.length}`);

  let done = 0;
  let miss = 0;
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.workId!)) continue;
    seen.add(r.workId!);

    const ed = await getWhakoomEdition(r.url).catch(() => null);
    await sleep(500);
    // Solo completamos lo que falta (no pisamos lo editado a mano).
    const patch: { author?: string; synopsis?: string } = {};
    if (!r.work?.author && ed?.author?.trim()) patch.author = ed.author.trim();
    if (!r.work?.synopsis && ed?.synopsis?.trim()) patch.synopsis = ed.synopsis.trim();
    if (!Object.keys(patch).length) {
      miss++;
      continue;
    }
    console.log(
      `#${r.workId} [${r.publisher}] "${r.title}" →${patch.author ? " autor" : ""}${patch.synopsis ? " sinopsis" : ""}`,
    );
    if (apply)
      await prisma.work
        .update({ where: { id: r.workId! }, data: patch })
        .catch(() => {});
    done++;
  }

  console.log(
    `\n${done} works completados${apply ? " (aplicado)" : ""}; ${miss} sin datos nuevos en Whakoom.`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
