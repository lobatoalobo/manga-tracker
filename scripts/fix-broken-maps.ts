/**
 * Detecta ediciones mapeadas a un anilistId que NO es un manga válido (un id de
 * anime, una novela, o un id borrado de AniList) → su ficha /manga/<id> tira 404.
 * Para cada una intenta re-resolver al manga correcto; si no puede, le saca el
 * anilistId (queda "sin mapear", curable con Auto).
 *
 *   npx tsx scripts/fix-broken-maps.ts            # dry-run (lista las rotas)
 *   npx tsx scripts/fix-broken-maps.ts --apply
 */
import { prisma } from "../lib/prisma";
import { resolveEditionSeries } from "../lib/resolveSeries";
import { invalidateEditionsCache } from "../lib/getMangaDetails";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Subconjunto de ids que SÍ existen como manga en AniList. */
async function validMangaIds(ids: number[]): Promise<Set<number>> {
  const valid = new Set<number>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:MANGA){id}}}`,
        variables: { ids: chunk },
      }),
    });
    const j = await res.json().catch(() => null);
    for (const m of j?.data?.Page?.media ?? []) valid.add(m.id);
    await sleep(700);
  }
  return valid;
}

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");

  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId: { not: null } },
    select: { id: true, publisher: true, slug: true, title: true, anilistId: true },
  });
  const ids = [...new Set(eds.map((e) => e.anilistId!))];
  console.log(`Mapeadas: ${eds.length} (${ids.length} ids distintos). Validando contra AniList…`);

  const valid = await validMangaIds(ids);
  const broken = eds.filter((e) => !valid.has(e.anilistId!));
  console.log(`Rotas (id no-manga / inexistente): ${broken.length}\n`);

  let fixed = 0;
  let cleared = 0;
  for (const e of broken) {
    const old = e.anilistId!;
    const newId = await resolveEditionSeries(e).catch(() => null);
    await sleep(400);

    if (newId && newId !== old && valid.has(newId)) {
      console.log(`✓ #${e.id} "${e.title}" [${e.publisher}] ${old} → ${newId}`);
      if (apply) {
        await prisma.publisherEdition.update({ where: { id: e.id }, data: { anilistId: newId } });
        await invalidateEditionsCache(old).catch(() => {});
        await invalidateEditionsCache(newId).catch(() => {});
      }
      fixed++;
    } else {
      console.log(`· #${e.id} "${e.title}" [${e.publisher}] ${old} → sin mapear`);
      if (apply) {
        await prisma.publisherEdition.update({ where: { id: e.id }, data: { anilistId: null } });
        await invalidateEditionsCache(old).catch(() => {});
      }
      cleared++;
    }
  }

  console.log(
    `\n${fixed} re-resueltas, ${cleared} desmapeadas${apply ? " (aplicado)" : ""}.`,
  );
  if (!apply) console.log("DRY-RUN: corré con --apply.");
  await prisma.$disconnect();
}

main();
