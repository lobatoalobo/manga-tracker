/**
 * Decodifica entidades HTML que quedaron literales en la base (I&quot;s → I"s)
 * en Work (title/author/synopsis/originalTitle) y PublisherEdition (title).
 * Recalcula normTitle cuando cambia el título. Idempotente y con dbRetry.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/fix-entities.ts [--dry]
 */
import { prisma } from "../lib/prisma";
import { decodeEntities } from "../lib/decodeEntities";
import { normalizeTitle } from "../lib/catalog";
import { dbRetry } from "../lib/dbRetry";

async function main() {
  const dry = process.argv.includes("--dry");

  const works = await dbRetry(() =>
    prisma.work.findMany({
      select: { id: true, title: true, author: true, synopsis: true, originalTitle: true },
    }),
  );
  let wChanged = 0;
  for (const w of works) {
    const title = decodeEntities(w.title);
    const author = w.author ? decodeEntities(w.author) : w.author;
    const synopsis = w.synopsis ? decodeEntities(w.synopsis) : w.synopsis;
    const originalTitle = w.originalTitle ? decodeEntities(w.originalTitle) : w.originalTitle;
    if (
      title === w.title &&
      author === w.author &&
      synopsis === w.synopsis &&
      originalTitle === w.originalTitle
    )
      continue;
    wChanged++;
    if (wChanged <= 30)
      console.log(`  work #${w.id}: ${JSON.stringify(w.title)} → ${JSON.stringify(title)}`);
    if (!dry)
      await dbRetry(() =>
        prisma.work.update({
          where: { id: w.id },
          data: { title, normTitle: normalizeTitle(title), author, synopsis, originalTitle },
        }),
      );
  }

  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({ select: { id: true, title: true } }),
  );
  let eChanged = 0;
  for (const e of eds) {
    const title = decodeEntities(e.title);
    if (title === e.title) continue;
    eChanged++;
    if (eChanged <= 30)
      console.log(`  edición #${e.id}: ${JSON.stringify(e.title)} → ${JSON.stringify(title)}`);
    if (!dry)
      await dbRetry(() =>
        prisma.publisherEdition.update({
          where: { id: e.id },
          data: { title, normTitle: normalizeTitle(title) },
        }),
      );
  }

  console.log(
    `\n${dry ? "[DRY] " : ""}Works ${wChanged} · ediciones ${eChanged} ${dry ? "a corregir" : "corregidas"}.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
