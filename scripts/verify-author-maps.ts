/**
 * Verifica los mapeos a AniList contra el autor que guardamos (de Whakoom): si
 * NINGÚN autor de AniList coincide con el nuestro, el mapeo es de un homónimo
 * (ej. "Adabana" de NON mapeado al hentai homónimo). Re-resuelve con la lógica
 * nueva (exige autor) o desmapea.
 *
 *   npx tsx scripts/verify-author-maps.ts            # dry-run (lista las dudosas)
 *   npx tsx scripts/verify-author-maps.ts --apply
 */
import { prisma } from "../lib/prisma";
import { authorMatches } from "../lib/authorMatch";
import { resolveEditionSeries } from "../lib/resolveSeries";
import { invalidateEditionsCache } from "../lib/getMangaDetails";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Staff (autores) de AniList por id, en lotes. */
async function staffByIds(ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:MANGA){id staff(perPage:4){nodes{name{full}}}}}}`,
        variables: { ids: chunk },
      }),
    });
    const j = await res.json().catch(() => null);
    for (const m of j?.data?.Page?.media ?? [])
      out.set(
        m.id,
        (m.staff?.nodes ?? []).map((n: any) => n?.name?.full).filter(Boolean),
      );
    await sleep(700);
  }
  return out;
}

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");

  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId: { not: null }, work: { author: { not: null } } },
    select: {
      id: true, publisher: true, slug: true, title: true, anilistId: true,
      work: { select: { author: true } },
    },
  });
  const ids = [...new Set(eds.map((e) => e.anilistId!))];
  console.log(`Mapeadas con autor propio: ${eds.length} (${ids.length} ids). Trayendo staff…`);
  const staff = await staffByIds(ids);

  // Sospechosa: tenemos staff de AniList y NINGUNO coincide con nuestro autor.
  const bad = eds.filter((e) => {
    const names = staff.get(e.anilistId!) ?? [];
    if (names.length === 0) return false; // sin data → no tocar
    return !authorMatches(names, e.work!.author!);
  });
  console.log(`Sospechosas (autor no coincide): ${bad.length}\n`);

  let fixed = 0;
  let cleared = 0;
  for (const e of bad) {
    const old = e.anilistId!;
    const newId = await resolveEditionSeries(e).catch(() => null);
    await sleep(400);
    if (newId && newId !== old) {
      console.log(`✓ #${e.id} "${e.title}" [${e.publisher}] ${old} → ${newId} (autor ok)`);
      if (apply) {
        await prisma.publisherEdition.update({ where: { id: e.id }, data: { anilistId: newId } });
        await invalidateEditionsCache(old).catch(() => {});
        await invalidateEditionsCache(newId).catch(() => {});
      }
      fixed++;
    } else {
      console.log(`· #${e.id} "${e.title}" [${e.publisher}] ${old} → desmapear (autor ${e.work!.author})`);
      if (apply) {
        await prisma.publisherEdition.update({ where: { id: e.id }, data: { anilistId: null } });
        await invalidateEditionsCache(old).catch(() => {});
      }
      cleared++;
    }
  }

  console.log(`\n${fixed} re-resueltas, ${cleared} desmapeadas${apply ? " (aplicado)" : ""}.`);
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
