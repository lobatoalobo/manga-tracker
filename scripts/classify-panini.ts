/**
 * Clasifica los Works de Panini en MANGA vs COMIC (`Work.type`) con la heurística
 * de `lib/contentType` (Whakoom no expone categoría y MU/MD indexan cómics, ver
 * memoria panini-classify). A los COMIC les limpia la contaminación que dejó el
 * enrich (muId/mdId/géneros manga). NO toca lo curado a mano.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/classify-panini.ts          # dry
 *   node scripts/with-prod.mjs npx tsx scripts/classify-panini.ts --apply
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { looksLikeComic } from "../lib/contentType";

async function main() {
  const apply = process.argv.includes("--apply");
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { editions: { some: { publisher: { contains: "Panini" } } } },
      select: { id: true, title: true, type: true, muId: true, mdId: true,
        genres: true, rawGenres: true, demographic: true, curated: true },
    }),
  );
  let comic = 0, manga = 0, cleaned = 0;
  for (const w of works) {
    const type = looksLikeComic(w.title) ? "COMIC" : "MANGA";
    if (type === "COMIC") comic++; else manga++;
    if (!apply) continue;
    const data: Record<string, unknown> = {};
    if (w.type !== type) data.type = type;
    // Limpiar señal manga errónea en cómics (la metió el enrich). Respeta curado.
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
  console.log(`Panini: ${works.length} works → COMIC ${comic} · MANGA ${manga}` +
    (apply ? ` · cómics limpiados ${cleaned}` : " (DRY)"));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
