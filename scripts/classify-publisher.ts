/**
 * Clasifica los Works de una editorial en MANGA vs COMIC (`Work.type`) con la
 * heurística de `lib/contentType` (título Marvel/DC/indie + autor occidental).
 * A los COMIC les limpia la señal manga errónea (muId/mdId/géneros). Respeta lo
 * curado. Ver memoria panini-classify. `--publisher` matchea por `contains`.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/classify-publisher.ts --publisher "Utopía" [--apply]
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { looksLikeComic } from "../lib/contentType";

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const apply = process.argv.includes("--apply");
  const publisher = arg("--publisher");
  if (!publisher) { console.error("Falta --publisher"); process.exit(1); }

  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { editions: { some: { publisher: { contains: publisher } } } },
      select: { id: true, title: true, author: true, type: true, muId: true, mdId: true,
        genres: true, rawGenres: true, demographic: true, curated: true },
    }),
  );
  let comic = 0, manga = 0, cleaned = 0;
  for (const w of works) {
    const type = looksLikeComic(w.title, w.author) ? "COMIC" : "MANGA";
    if (type === "COMIC") comic++; else manga++;
    if (!apply) continue;
    const data: Record<string, unknown> = {};
    if (w.type !== type) data.type = type;
    if (type === "COMIC") {
      const cur = new Set(w.curated);
      if (w.muId && !cur.has("muId")) data.muId = null;
      if (w.mdId && !cur.has("mdId")) data.mdId = null;
      if (w.genres.length && !cur.has("genres")) data.genres = [];
      if (w.rawGenres.length) data.rawGenres = [];
      if (w.demographic && !cur.has("demographic")) data.demographic = null;
      if (Object.keys(data).some((k) => k !== "type")) cleaned++;
    }
    if (Object.keys(data).length)
      await dbRetry(() => prisma.work.update({ where: { id: w.id }, data })).catch(() => {});
  }
  console.log(`${publisher}: ${works.length} works → COMIC ${comic} · MANGA ${manga}` +
    (apply ? ` · cómics limpiados ${cleaned}` : " (DRY)"));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
